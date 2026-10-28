import { SyncEngine } from '../../../../src/sync/SyncEngine';
import { StateDB } from '../../../../src/data/StateDB';
import { DEFAULT_SETTINGS } from '../../../../src/types';
import type { RemoteFileInfo } from '../../../../src/types';
import { Notice } from '../../support/obsidian';
import { makeLocalAdapter, makeStateAdapter, PLUGIN_DIR, toBuf } from '../../support/engineHarness';

const CODE = '.obsidian/plugins/p/main.js';
const DATA = '.obsidian/plugins/p/data.json';

async function build() {
  const stateDB = new StateDB(makeStateAdapter(), PLUGIN_DIR, 'dev1');
  await stateDB.load();
  const files: Record<string, string> = {};
  const localAdapter = makeLocalAdapter(files);
  const awaiting = new Set<string>();
  const baseStore = {
    get: jest.fn(() => undefined), set: jest.fn(), delete: jest.fn(),
    requestSave: jest.fn(), flush: jest.fn(async () => undefined),
  };
  const engine = new SyncEngine({
    app: {}, settings: { ...DEFAULT_SETTINGS, syncConfigFolder: true },
    localAdapter, stateDB, baseStore, statusBar: {}, webdavFactory: {},
    pluginDir: PLUGIN_DIR, configDir: '.obsidian', pluginsAwaitingRestart: awaiting,
  } as never);
  const remoteInfo = (path: string): RemoteFileInfo =>
    ({ path, fileId: 'f1', checksum: null, etag: '"e"', size: 4, lastModified: 9_000 });
  const client = {
    getFiles: jest.fn(async (p: string) => [remoteInfo(p)]),
    downloadFile: jest.fn(async () => toBuf('body')),
  };
  (engine as unknown as { client: unknown }).client = client;
  (engine as unknown as { features: unknown }).features = { isNextcloud: true };
  return { engine, awaiting, files };
}

describe('[SPEC:CPS-9] a manual resolution outside a sync requests restart', () => {
  beforeEach(() => { Notice.instances = []; });

  it('writing a plugin code file via pullRemoteToLocal marks the plugin and shows one restart notice', async () => {
    const { engine, awaiting, files } = await build();

    await engine.pullRemoteToLocal(CODE);

    expect(files[CODE]).toBe('body');
    expect([...awaiting]).toEqual(['p']);
    expect(Notice.instances).toHaveLength(1);
    expect(Notice.instances[0].message).toContain('Restart Obsidian');
    expect(Notice.instances[0].message).toContain('p');
  });

  it('writing only data.json changes neither the set nor the notices', async () => {
    const { engine, awaiting, files } = await build();

    await engine.pullRemoteToLocal(DATA);

    expect(files[DATA]).toBe('body');
    expect(awaiting.size).toBe(0);
    expect(Notice.instances).toHaveLength(0);
  });
});
