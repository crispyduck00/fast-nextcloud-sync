// Layer B — a file created on device A keeps its creation time on the server and on a device that downloads it for the
// first time (docs/spec.md §9.7). A's vault holds a file whose ctime is 2020-01-01; after A syncs, the server's
// nc:creation_time must be that second, a fresh device B must end with a local ctime within 1000 ms of it, and B's next
// sync must not issue any creation-time request (PROPPATCH).
import { describeLive } from '../support/env';
import { setupWorkspace } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { makeDevice } from '../support/engineDevice';
import { recordRequests } from '../support/requestRecorder';

const CTIME_2020_MS = Date.UTC(2020, 0, 1);
const CTIME_2020_SEC = CTIME_2020_MS / 1000;

describeLive('Layer B — creation time across two devices', (getEnv) => {
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

  it('[SPEC:CT-18] A uploads a 2020-ctime file; the server stores it and a fresh B reproduces it without PROPPATCH', async () => {
    const path = 'ct18-note.md';
    const a = makeDevice(getEnv(), ws.remoteBase, 'CT18-A');
    a.vault.seedLocal(path, 'created on A\n');
    a.vault.setCtime(path, CTIME_2020_MS);
    await a.sync();

    // The server holds the creation time A had (PROPFIND of nc:creation_time, in seconds).
    const listed = await baseClient.getFiles('');
    const onServer = listed.find((f) => f.path.endsWith(path));
    expect(onServer).toBeDefined();
    expect(Math.floor((onServer?.creationTime ?? 0) / 1000)).toBe(CTIME_2020_SEC); // [SPEC:CT-18] server value

    const b = makeDevice(getEnv(), ws.remoteBase, 'CT18-B');
    await b.sync();
    expect(b.vault.localExists(path)).toBe(true);
    const bCtime = b.vault.getCtime(path);
    expect(bCtime).toBeDefined();
    expect(Math.abs((bCtime ?? 0) - CTIME_2020_MS)).toBeLessThan(1000); // [SPEC:CT-18] B's local ctime

    // Second sync of B: nothing to align, so no creation-time request is sent.
    const recorder = recordRequests();
    try {
      await b.sync();
    } finally {
      recorder.restore();
    }
    expect(recorder.requests.filter((r) => r.method === 'PROPPATCH')).toEqual([]); // [SPEC:CT-18] no PROPPATCH
    expect(Math.abs((b.vault.getCtime(path) ?? 0) - CTIME_2020_MS)).toBeLessThan(1000);
  }, 180_000);
});
