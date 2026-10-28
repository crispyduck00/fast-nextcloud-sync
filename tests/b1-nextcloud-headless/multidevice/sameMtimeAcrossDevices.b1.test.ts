// Layer B — two devices that sync the same remote state end with the same mtime per file, equal to the server's
// (docs/spec.md §9.6). Each device is an independent SyncEngine over its own FakeVault.
import { describeLive } from '../support/env';
import { setupWorkspace } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { makeDevice } from '../support/engineDevice';
import { bytesBuf, textBuf } from '../support/helpers';

const sec = (ms: number | undefined): number => Math.floor((ms ?? 0) / 1000);

describeLive('Layer B — same mtime across devices', (getEnv) => {
  let ws: IsolatedWorkspace;
  let baseClient: NextcloudClient;

  beforeAll(async () => {
    const s = await setupWorkspace(getEnv());
    ws = s.ws;
    baseClient = s.client;
  });

  afterAll(async () => {
    if (baseClient && ws) await cleanupWorkspace(baseClient, ws);
  });

  it('[SPEC:MT-1] two devices syncing the same server state hold the server mtime, equal to each other', async () => {
    const files: Array<[string, ArrayBuffer, number]> = [
      ['same-a.md', textBuf('alpha\n'), 1577836800000], // 2020-01-01
      ['same-b.md', textBuf('bravo\n'), 1609459200000], // 2021-01-01
      ['same-c.png', bytesBuf(256), 1640995200000], // 2022-01-01
    ];
    for (const [p, data, mtime] of files) await baseClient.uploadFile(p, data, mtime);

    const listed = await baseClient.getFiles('');
    const desktop = makeDevice(getEnv(), ws.remoteBase, 'MT1-desktop');
    const mobile = makeDevice(getEnv(), ws.remoteBase, 'MT1-mobile', { syncIntervalMinutes: 0, watchOnChangeEnabled: false });
    await desktop.sync();
    await mobile.sync();

    for (const [p, , mtime] of files) {
      const server = listed.find((x) => x.path.endsWith(p));
      expect(sec(server?.lastModified)).toBe(sec(mtime)); // precondition: the server kept the time
      const dm = (await desktop.vault.adapter.stat(p))?.mtime;
      const mm = (await mobile.vault.adapter.stat(p))?.mtime;
      expect(sec(dm)).toBe(sec(server?.lastModified)); // [SPEC:MT-1] desktop == server
      expect(sec(mm)).toBe(sec(server?.lastModified)); // [SPEC:MT-1] mobile == server
      expect(sec(dm)).toBe(sec(mm)); // [SPEC:MT-1] devices agree
    }
  }, 180_000);
});
