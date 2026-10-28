import {
  ConfigSyncResolver,
  CONFIG_SYNC_CATEGORIES,
  CORE_PLUGIN_CONFIG_FILES,
} from '../../../src/sync/ConfigSyncResolver';
import { ConfigSyncCategories } from '../../../src/types';
import { emptyPluginGate } from '../support/pluginPorts';
import type { PluginPathGate } from '../../../src/sync/plugins/PluginSyncCoordinator';

const CONFIG_DIR = '.obsidian';
const PLUGIN_DIR = `${CONFIG_DIR}/plugins/nextcloud-sync`;

// Two categories — Bookmarks and "Other settings" (appearance/themes/hotkeys/core).
function categories(overrides: Partial<ConfigSyncCategories> = {}): ConfigSyncCategories {
  return { bookmarks: false, others: false, ...overrides };
}

// Minimal in-memory LocalAdapter for enumeration tests.
function makeAdapter(tree: { files: Record<string, true>; dirs: Record<string, { files: string[]; folders: string[] }> }) {
  return {
    stat: jest.fn(async (p: string) => (tree.files[p] ? { size: 1, mtime: 1 } : null)),
    list: jest.fn(async (dir: string) => tree.dirs[dir] ?? { files: [], folders: [] }),
  };
}

function makeResolver(opts: {
  syncConfigFolder: boolean;
  configSync?: Partial<ConfigSyncCategories>;
  configDir?: string;
  adapter?: ReturnType<typeof makeAdapter>;
}, pluginGate: PluginPathGate = emptyPluginGate) {
  const configDir = opts.configDir ?? CONFIG_DIR;
  return new ConfigSyncResolver({
    configDir,
    settings: { syncConfigFolder: opts.syncConfigFolder, configSync: categories(opts.configSync) },
    pluginDir: `${configDir}/plugins/nextcloud-sync`,
    localAdapter: opts.adapter ?? (makeAdapter({ files: {}, dirs: {} }) as never),
    pluginGate,
  });
}

// A fake gate: a listed id passes for every file except a data.json awaiting restart.
function fakeGate(ids: string[], restart: string[] = []): PluginPathGate {
  const set = new Set(ids);
  const wait = new Set(restart);
  return {
    isPluginFileIncluded: (id, file) => set.has(id) && !(file === 'data.json' && wait.has(id)),
    includedPluginIds: () => [...set].sort(),
  };
}

describe('[SPEC:CPS-1] the plugin\'s own folder never syncs', () => {
  it('is excluded for all four bundle files even when the gate lists its own id', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true } }, fakeGate(['nextcloud-sync']));
    for (const f of ['manifest.json', 'main.js', 'styles.css', 'data.json']) {
      expect(r.isIncluded(`${PLUGIN_DIR}/${f}`)).toBe(false);
    }
  });
});

describe('[SPEC:CPS-2] isIncluded for community plugin files', () => {
  const paths: Array<[string, boolean]> = [
    ['plugins/p/manifest.json', true],
    ['plugins/p/main.js', true],
    ['plugins/p/styles.css', true],
    ['plugins/p/data.json', true],
    ['plugins/p/sub/main.js', false],
    ['plugins/p/other.txt', false],
    ['plugins/p', false],
    ['plugins', false],
  ];
  const rows: Array<[boolean, boolean, boolean, string, boolean]> = [];
  for (const master of [true, false]) {
    for (const listed of [true, false]) {
      for (const awaiting of [true, false]) {
        for (const [rel, isBundle] of paths) {
          const codeOrData = isBundle;
          const blocked = awaiting && rel.endsWith('/data.json');
          rows.push([master, listed, awaiting, rel, master && listed && codeOrData && !blocked]);
        }
      }
    }
  }

  it.each(rows)('master=%s listed=%s awaitingRestart=%s %s -> %s', (master, listed, awaiting, rel, expected) => {
    const gate = fakeGate(listed ? ['p'] : [], awaiting ? ['p'] : []);
    const r = makeResolver({ syncConfigFolder: master, configSync: { others: true } }, gate);
    expect(r.isIncluded(`${CONFIG_DIR}/${rel}`)).toBe(expected);
  });

  it('A5: enumerateIncludedPaths stats the four files of each gated plugin and never lists plugins/', async () => {
    const present = new Set([`${CONFIG_DIR}/plugins/p/main.js`, `${CONFIG_DIR}/plugins/p/data.json`]);
    const adapter = {
      stat: jest.fn(async (p: string) => (present.has(p) ? { size: 1, mtime: 1 } : null)),
      list: jest.fn(async (_dir: string) => ({ files: [] as string[], folders: [] as string[] })),
    };
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true }, adapter: adapter as never }, fakeGate(['p']));
    const out = await r.enumerateIncludedPaths();
    expect(out).toEqual(expect.arrayContaining([...present]));
    expect(out.filter(p => p.includes('/plugins/')).sort()).toEqual([...present].sort());
    const listed = adapter.list.mock.calls.map(c => String(c[0]));
    expect(listed.some(p => p.startsWith(`${CONFIG_DIR}/plugins`))).toBe(false);
  });
});

describe('ConfigSyncResolver.isIncluded', () => {
  // C1: master off → every config path excluded, even with categories that would match.
  it('C1: excludes all config paths when the master toggle is off', () => {
    const r = makeResolver({ syncConfigFolder: false, configSync: { others: true, bookmarks: true } });
    expect(r.isIncluded(`${CONFIG_DIR}/appearance.json`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/themes/x.css`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/bookmarks.json`)).toBe(false);
  });

  // Not under configDir → never excluded by the resolver (ordinary vault files).
  it('returns false for paths outside the config dir', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true } });
    expect(r.isIncluded('Notes/a.md')).toBe(false);
    expect(r.isUnderConfigDir('Notes/a.md')).toBe(false);
  });

  // The config dir entry itself is not a syncable file.
  it('returns false for the config dir itself', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true } });
    expect(r.isIncluded(CONFIG_DIR)).toBe(false);
    expect(r.isUnderConfigDir(CONFIG_DIR)).toBe(true);
  });

  // C2/C3: hard exclusions beat every category, even with both categories enabled.
  it('C2: never includes plugins/** when the plugin gate is empty, even with all categories on', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true } });
    expect(r.isIncluded(`${CONFIG_DIR}/plugins/some-plugin/main.js`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/plugins/some-plugin/data.json`)).toBe(false);
  });

  it('C3: never includes the plugin state DB with any settings', () => {
    const gate = fakeGate(['some-plugin', 'nextcloud-sync']);
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true } }, gate);
    expect(r.isIncluded(`${PLUGIN_DIR}/state.json`)).toBe(false);
    expect(r.isIncluded(`${PLUGIN_DIR}/data.json`)).toBe(false);
  });

  // C4: "Other settings" folds appearance/app, themes & snippets, hotkeys, and core plugins.
  it('C4: Other settings includes appearance/app, themes & snippets, hotkeys, and core plugins', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true } });
    expect(r.isIncluded(`${CONFIG_DIR}/appearance.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/app.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/themes/Cool/theme.css`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/snippets/tweak.css`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/hotkeys.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/core-plugins.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/graph.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/daily-notes.json`)).toBe(true);
    // bookmarks.json is owned by the Bookmarks category, not Other settings.
    expect(CORE_PLUGIN_CONFIG_FILES).not.toContain('bookmarks.json');
    expect(r.isIncluded(`${CONFIG_DIR}/bookmarks.json`)).toBe(false);
  });

  it('C4: Bookmarks includes only bookmarks.json', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { bookmarks: true } });
    expect(r.isIncluded(`${CONFIG_DIR}/bookmarks.json`)).toBe(true);
    expect(r.isIncluded(`${CONFIG_DIR}/graph.json`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/appearance.json`)).toBe(false);
  });

  // C5: device-specific / unknown files excluded even with everything on.
  it('C5: excludes workspace.json and unknown files even with all categories on', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true } });
    expect(r.isIncluded(`${CONFIG_DIR}/workspace.json`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/workspace-mobile.json`)).toBe(false);
    expect(r.isIncluded(`${CONFIG_DIR}/something-unknown.json`)).toBe(false);
  });

  // Relocated config dir must still match (no hardcoded `.obsidian`).
  it('works with a relocated config directory', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true }, configDir: '.config-obsidian' });
    expect(r.isIncluded('.config-obsidian/appearance.json')).toBe(true);
    expect(r.isIncluded('.obsidian/appearance.json')).toBe(false);
  });

  it('isConfigFolderConflictPath matches included config paths only', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true } });
    expect(r.isConfigFolderConflictPath(`${CONFIG_DIR}/appearance.json`)).toBe(true);
    expect(r.isConfigFolderConflictPath(`${CONFIG_DIR}/workspace.json`)).toBe(false);
    expect(r.isConfigFolderConflictPath('Notes/a.md')).toBe(false);
  });
});

// Community plugins sync only as the four bundle files of a plugin on the gate's list. Nothing else
// under <configDir>/plugins/** may enter the sync set, whatever the toggles.
describe('ConfigSyncResolver - community plugin files (GitHub issue #12)', () => {
  const BUNDLE_FILES = [
    `${CONFIG_DIR}/plugins/dataview/main.js`,
    `${CONFIG_DIR}/plugins/dataview/manifest.json`,
    `${CONFIG_DIR}/plugins/dataview/styles.css`,
    `${CONFIG_DIR}/plugins/dataview/data.json`,
  ];
  const NOT_BUNDLE = [
    `${CONFIG_DIR}/plugins/templater-obsidian/main.js`,
    `${CONFIG_DIR}/plugins/dataview/assets/nested/blob.bin`,
  ];
  const gate = () => fakeGate(['dataview']);

  it('isIncluded is true only for the four files of a gated plugin', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true } }, gate());
    for (const p of BUNDLE_FILES) expect(r.isIncluded(p)).toBe(true);
    for (const p of NOT_BUNDLE) expect(r.isIncluded(p)).toBe(false);
  });

  it('isConfigFolderConflictPath routes only gated bundle files as config conflicts', () => {
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true } }, gate());
    for (const p of BUNDLE_FILES) expect(r.isConfigFolderConflictPath(p)).toBe(true);
    for (const p of NOT_BUNDLE) expect(r.isConfigFolderConflictPath(p)).toBe(false);
  });

  it('enumerateIncludedPaths lists only gated bundle files even when plugins/ is populated', async () => {
    const adapter = makeAdapter({
      files: {
        [`${CONFIG_DIR}/appearance.json`]: true,
        [`${CONFIG_DIR}/plugins/dataview/main.js`]: true,
        [`${CONFIG_DIR}/plugins/dataview/assets/nested/blob.bin`]: true,
      },
      dirs: {
        [`${CONFIG_DIR}/plugins`]: { files: [], folders: [`${CONFIG_DIR}/plugins/dataview`] },
        [`${CONFIG_DIR}/plugins/dataview`]: { files: [`${CONFIG_DIR}/plugins/dataview/main.js`], folders: [] },
      },
    });
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true, bookmarks: true }, adapter }, gate());
    const paths = await r.enumerateIncludedPaths();
    expect(paths).toContain(`${CONFIG_DIR}/plugins/dataview/main.js`);
    expect(paths).not.toContain(`${CONFIG_DIR}/plugins/dataview/assets/nested/blob.bin`);
    expect(paths.filter(p => p.includes('/plugins/'))).toEqual([`${CONFIG_DIR}/plugins/dataview/main.js`]);
  });
});

describe('ConfigSyncResolver.enumerateIncludedPaths', () => {
  it('returns [] when the master toggle is off', async () => {
    const r = makeResolver({ syncConfigFolder: false, configSync: { others: true } });
    expect(await r.enumerateIncludedPaths()).toEqual([]);
  });

  it('omits allowlist files that do not exist', async () => {
    const adapter = makeAdapter({ files: { [`${CONFIG_DIR}/appearance.json`]: true }, dirs: {} });
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true }, adapter });
    // app.json / hotkeys.json / core-plugin files absent → only appearance.json returned.
    expect(await r.enumerateIncludedPaths()).toEqual([`${CONFIG_DIR}/appearance.json`]);
  });

  it('recurses themes/ and snippets/ and never returns plugins/', async () => {
    const adapter = makeAdapter({
      files: {},
      dirs: {
        [`${CONFIG_DIR}/themes`]: { files: [`${CONFIG_DIR}/themes/Cool/theme.css`], folders: [`${CONFIG_DIR}/themes/Cool`] },
        [`${CONFIG_DIR}/themes/Cool`]: { files: [`${CONFIG_DIR}/themes/Cool/theme.css`], folders: [] },
        [`${CONFIG_DIR}/snippets`]: { files: [`${CONFIG_DIR}/snippets/tweak.css`], folders: [] },
      },
    });
    const r = makeResolver({ syncConfigFolder: true, configSync: { others: true }, adapter });
    const paths = await r.enumerateIncludedPaths();
    expect(paths).toEqual(expect.arrayContaining([`${CONFIG_DIR}/snippets/tweak.css`, `${CONFIG_DIR}/themes/Cool/theme.css`]));
    expect(paths.some(p => p.includes('/plugins/'))).toBe(false);
    // Every enumerated path must agree with the predicate.
    for (const p of paths) expect(r.isIncluded(p)).toBe(true);
  });
});

describe('CONFIG_SYNC_CATEGORIES', () => {
  it('exposes exactly the two settings keys for the UI (feature 029)', () => {
    expect(CONFIG_SYNC_CATEGORIES.map(c => c.key)).toEqual(['bookmarks', 'others']);
  });
});
