// Layer B — community plugin bundles between two devices against a live Nextcloud (docs/spec.md §7).
import { describeLive, LiveEnv } from '../support/env';
import { setupWorkspace } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { Device, makeDevice, restartDevice } from '../support/engineDevice';
import { FakeVault } from '../support/fakeVault';
import { recordRequests } from '../support/requestRecorder';
import { Notice } from '../__mocks__/obsidian';

const CONFIG_DIR = '.obsidian';
const PLUGIN_DIR = '.obsidian/plugins/nextcloud-sync';
const OWN_ID = PLUGIN_DIR.slice(PLUGIN_DIR.lastIndexOf('/') + 1);
const BUNDLE = ['manifest.json', 'main.js', 'styles.css', 'data.json'] as const;

const dirOf = (id: string): string => `${CONFIG_DIR}/plugins/${id}`;
const bundleOf = (id: string): string[] => BUNDLE.map((f) => `${dirOf(id)}/${f}`);

function bodyOf(id: string, file: string): string {
  return file === 'manifest.json'
    ? JSON.stringify({ id, name: id, version: '1.0.0', minAppVersion: '0.15.0' })
    : `${id}: body of ${file}`;
}

// The four bundle files plus the paths that never sync: a subfolder file and an extra file in the plugin folder.
function seedPlugin(vault: FakeVault, id: string): void {
  for (const file of BUNDLE) vault.seedLocal(`${dirOf(id)}/${file}`, bodyOf(id, file));
  vault.seedLocal(`${dirOf(id)}/sub/extra.js`, `${id}: subfolder file`);
  vault.seedLocal(`${dirOf(id)}/README.md`, `${id}: readme`);
}

const CODE_FILES = ['manifest.json', 'main.js', 'styles.css'] as const;

// A plugin whose three code files all carry `version`, so a bundle of one version is recognizable file by file.
function versionedBody(id: string, file: string, version: string): string {
  return file === 'manifest.json'
    ? JSON.stringify({ id, name: id, version, minAppVersion: '0.15.0' })
    : `${id}: ${version} body of ${file}`;
}

function seedVersioned(vault: FakeVault, id: string, version: string): void {
  for (const file of CODE_FILES) vault.seedLocal(`${dirOf(id)}/${file}`, versionedBody(id, file, version));
}

function expectBundleVersion(vault: FakeVault, id: string, version: string): void {
  for (const file of CODE_FILES) {
    expect(vault.readLocal(`${dirOf(id)}/${file}`)).toBe(versionedBody(id, file, version));
  }
  expect(vault.readLocal(`${dirOf(id)}/main.js`)).not.toContain('<<<<<<<');
}

const hasPluginFiles = (vault: FakeVault, id: string): boolean => bundleOf(id).some((p) => vault.localExists(p));

describeLive('Layer B — community plugins between two devices (engine)', (getEnv) => {
  let ws: IsolatedWorkspace;
  let baseClient: NextcloudClient;

  // A fresh remote folder per test: each scenario starts from an empty server.
  beforeEach(async () => {
    const s = await setupWorkspace(getEnv());
    ws = s.ws;
    baseClient = s.client;
  });

  afterEach(async () => {
    if (baseClient && ws) await cleanupWorkspace(baseClient, ws);
  });

  const device = (env: LiveEnv, id: string, list: string[]): Device =>
    makeDevice(env, ws.remoteBase, id, { syncConfigFolder: true, syncedCommunityPlugins: list });

  const serverPaths = async (): Promise<string[]> => (await baseClient.getFiles('')).map((f) => f.path);

  it('[SPEC:CPS-12] E1: the four bundle files reach the other device; subfolders and extra files do not', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp1', ['p1']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedPlugin(a.vault, 'p1');
    await a.sync();

    const onServer = await serverPaths();
    expect(onServer).toEqual(expect.arrayContaining(bundleOf('p1')));
    expect(onServer).not.toContain(`${dirOf('p1')}/sub/extra.js`);
    expect(onServer).not.toContain(`${dirOf('p1')}/README.md`);

    const b = device(env, 'deviceB-cp1', ['p1']);
    // The plugin is not enabled on B, so its data.json arrives together with the code (an enabled plugin's would be held, E8).
    b.vault.seedLocal(`${CONFIG_DIR}/community-plugins.json`, '[]');
    await b.sync();

    for (const file of BUNDLE) {
      expect(b.vault.readLocal(`${dirOf('p1')}/${file}`)).toBe(bodyOf('p1', file));
    }
    expect(b.vault.localExists(`${dirOf('p1')}/sub/extra.js`)).toBe(false);
    expect(b.vault.localExists(`${dirOf('p1')}/README.md`)).toBe(false);
  });

  it('[SPEC:CPS-12] E2: after both devices update to different versions, two syncs each leave the higher version on both', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp2', ['p2']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedVersioned(a.vault, 'p2', '1.0.0');
    await a.sync();
    const b = device(env, 'deviceB-cp2', ['p2']);
    await b.sync();
    expectBundleVersion(b.vault, 'p2', '1.0.0');

    seedVersioned(a.vault, 'p2', '2.0.0');
    seedVersioned(b.vault, 'p2', '3.0.0');
    await a.sync();
    await b.sync();
    await a.sync();
    await b.sync();

    expectBundleVersion(a.vault, 'p2', '3.0.0');
    expectBundleVersion(b.vault, 'p2', '3.0.0');
  });

  it('[SPEC:CPS-12] E3: a downgrade made on one device reaches the other', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp3', ['p3']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedVersioned(a.vault, 'p3', '2.0.0');
    await a.sync();
    const b = device(env, 'deviceB-cp3', ['p3']);
    await b.sync();
    expectBundleVersion(b.vault, 'p3', '2.0.0');

    seedVersioned(b.vault, 'p3', '1.0.0');
    await b.sync();
    await a.sync();

    expectBundleVersion(a.vault, 'p3', '1.0.0');
    expectBundleVersion(b.vault, 'p3', '1.0.0');
  });

  it('[SPEC:CPS-12] E7: enabling a plugin that already has another version on the server resolves by version', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp7', ['p7a', 'p7b']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedVersioned(a.vault, 'p7a', '1.0.0');
    seedVersioned(a.vault, 'p7b', '2.0.0');
    await a.sync();

    // B starts with its own copies: newer than the server for p7a, older for p7b, then lists both.
    const b = device(env, 'deviceB-cp7', ['p7a', 'p7b']);
    seedVersioned(b.vault, 'p7a', '2.0.0');
    seedVersioned(b.vault, 'p7b', '1.0.0');
    await b.sync();
    await a.sync();

    expectBundleVersion(b.vault, 'p7a', '2.0.0');
    expectBundleVersion(b.vault, 'p7b', '2.0.0');
    expectBundleVersion(a.vault, 'p7a', '2.0.0');
    expectBundleVersion(a.vault, 'p7b', '2.0.0');
  });

  it('[SPEC:CPS-12] E4: a plugin only one device lists stays on that device, and an unlisted local plugin is not uploaded', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp4', ['p4']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedPlugin(a.vault, 'p4');
    await a.sync();

    // B lists a different plugin, and has a local plugin of its own that it did not choose.
    const b = device(env, 'deviceB-cp4', ['q4']);
    seedPlugin(b.vault, 'r4');
    await b.sync();

    expect(hasPluginFiles(b.vault, 'p4')).toBe(false);
    const onServer = await serverPaths();
    expect(onServer.filter((p) => p.startsWith(`${dirOf('r4')}/`))).toEqual([]);
    expect(onServer).toEqual(expect.arrayContaining(bundleOf('p4')));

    // A's next sync neither receives B's unlisted plugin nor loses its own.
    await a.sync();
    expect(hasPluginFiles(a.vault, 'r4')).toBe(false);
    expect(hasPluginFiles(a.vault, 'p4')).toBe(true);
    expect(await serverPaths()).toEqual(expect.arrayContaining(bundleOf('p4')));
  });

  it('[SPEC:CPS-12] E5: uninstalling a plugin on one device removes its files on the other and keeps the folder', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp5', ['p5']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedPlugin(a.vault, 'p5');
    await a.sync();
    const b = device(env, 'deviceB-cp5', ['p5']);
    // The plugin is not enabled on B, so its data.json arrives together with the code (an enabled plugin's would be held, E8).
    b.vault.seedLocal(`${CONFIG_DIR}/community-plugins.json`, '[]');
    await b.sync();
    expect(bundleOf('p5').every((p) => b.vault.localExists(p))).toBe(true);

    a.vault.deleteLocalTree(dirOf('p5'));
    await a.sync();
    expect((await serverPaths()).filter((p) => p.startsWith(`${dirOf('p5')}/`))).toEqual([]);

    const restarted = await restartDevice(getEnv(), ws.remoteBase, b, { syncConfigFolder: true, syncedCommunityPlugins: ['p5'] });
    await restarted.sync();

    expect(hasPluginFiles(restarted.vault, 'p5')).toBe(false);
    expect(restarted.vault.folderExists(dirOf('p5'))).toBe(true);
  });

  it('[SPEC:CPS-12] E6: this plugin\'s own id in the list never puts its folder on the server', async () => {
    const env = getEnv();
    // The list is written straight into the device settings, bypassing the normalization on load and save.
    const a = device(env, 'deviceA-cp6', [OWN_ID, 'p6']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedPlugin(a.vault, OWN_ID);
    seedPlugin(a.vault, 'p6');
    await a.sync();

    const onServer = await serverPaths();
    expect(onServer.filter((p) => p.startsWith(`${dirOf(OWN_ID)}`))).toEqual([]);
    expect(onServer).toEqual(expect.arrayContaining(bundleOf('p6')));
  });

  it('[SPEC:CPS-12] E9: unlisting a plugin, deleting its local folder and listing it again never deletes its server files', async () => {
    const env = getEnv();
    const a = device(env, 'deviceA-cp9', ['p9']);
    a.vault.seedLocal('keep.md', 'survivor');
    seedPlugin(a.vault, 'p9');
    await a.sync();
    const b = device(env, 'deviceB-cp9', ['p9']);
    // The plugin is not enabled on B, so its data.json arrives together with the code (an enabled plugin's would be held, E8).
    b.vault.seedLocal(`${CONFIG_DIR}/community-plugins.json`, '[]');
    await b.sync();
    expect(bundleOf('p9').every((p) => b.vault.localExists(p))).toBe(true);

    b.settings.syncedCommunityPlugins = [];
    await b.sync();
    expect(await serverPaths()).toEqual(expect.arrayContaining(bundleOf('p9')));

    b.vault.deleteLocalTree(dirOf('p9'));
    await b.sync();
    expect(await serverPaths()).toEqual(expect.arrayContaining(bundleOf('p9')));

    b.settings.syncedCommunityPlugins = ['p9'];
    await b.sync();

    expect(await serverPaths()).toEqual(expect.arrayContaining(bundleOf('p9')));
  });

  describe('[SPEC:CPS-13] data.json waits for restart', () => {
    const restartNotices = (): Notice[] => Notice.instances.filter((n) => n.message.includes('Restart Obsidian'));

    it('E8: no data.json request while the plugin awaits restart, and both devices converge after the restart', async () => {
      const env = getEnv();
      Notice.instances = [];
      const a = device(env, 'deviceA-cp8', ['p']);
      a.vault.seedLocal('keep.md', 'survivor');
      seedPlugin(a.vault, 'p');
      await a.sync();

      // B has the plugin enabled, so the code that arrives needs a restart there.
      const b = device(env, 'deviceB-cp8', ['p']);
      b.vault.seedLocal(`${CONFIG_DIR}/community-plugins.json`, JSON.stringify(['p']));
      await b.sync();
      expect(hasPluginFiles(b.vault, 'p')).toBe(true);
      expect(restartNotices()).toHaveLength(1);
      expect(restartNotices()[0].message).toContain('p');
      // The sync that delivered the code did not deliver data.json (the old code is still running).
      expect(b.vault.localExists(`${dirOf('p')}/data.json`)).toBe(false);

      // A changes the settings file after B received the code, so the server holds a newer data.json.
      const dataPath = `${dirOf('p')}/data.json`;
      a.vault.seedLocal(dataPath, 'p: data.json changed on A after the code was delivered');
      await a.sync();

      const recorder = recordRequests();
      try {
        await b.sync();
      } finally {
        recorder.restore();
      }
      const touchingData = recorder.requests.filter(
        (r) => ['PUT', 'GET', 'DELETE'].includes(r.method) && r.url.includes('/p/data.json'),
      );
      expect(touchingData).toEqual([]);

      const restarted = await restartDevice(getEnv(), ws.remoteBase, b, { syncConfigFolder: true, syncedCommunityPlugins: ['p'] });
      await restarted.sync();
      await a.sync();

      expect(restarted.vault.readLocal(dataPath)).toBe('p: data.json changed on A after the code was delivered');
      expect(a.vault.readLocal(dataPath)).toBe(restarted.vault.readLocal(dataPath));
    });
  });

  describe('[SPEC:CPS-21] candidates from a real server', () => {
    it('E10: a plugin that exists only on the server is listed with its manifest name and version', async () => {
      const env = getEnv();
      const a = device(env, 'deviceA-cp10', ['r']);
      a.vault.seedLocal('keep.md', 'survivor');
      for (const file of CODE_FILES) {
        a.vault.seedLocal(
          `${dirOf('r')}/${file}`,
          file === 'manifest.json'
            ? JSON.stringify({ id: 'r', name: 'Remote only plugin', version: '2.3.4', minAppVersion: '0.15.0' })
            : `r: body of ${file}`,
        );
      }
      await a.sync();

      // B lists nothing and has no `r` folder, so `r` can only come from the server.
      const b = device(env, 'deviceB-cp10', []);
      expect(hasPluginFiles(b.vault, 'r')).toBe(false);
      const list = await b.engine.listCommunityPluginCandidates();

      expect(list.remoteAvailable).toBe(true);
      expect(list.candidates).toContainEqual(expect.objectContaining({
        id: 'r', name: 'Remote only plugin', version: '2.3.4', location: 'remote',
      }));
    });
  });
});
