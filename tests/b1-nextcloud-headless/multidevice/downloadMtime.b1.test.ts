// Layer B — the local mtime of a downloaded file is the remote mtime (docs/spec.md §9.6). The server holds files whose
// mtime was set to 2020-01-01T00:00:00Z through X-OC-MTime; one fresh device syncs them down and the local stat.mtime
// must match at second precision, for text and binary bodies. A FakeVault stores `options?.mtime ?? Date.now()`, so an
// implementation that does not pass the mtime to the write call would end with the current time, never with 2020.
import { describeLive } from '../support/env';
import { setupWorkspace } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { makeDevice } from '../support/engineDevice';
import { bytesBuf, textBuf } from '../support/helpers';

const MTIME_2020_SEC = 1577836800; // 2020-01-01T00:00:00Z

describeLive('Layer B — downloaded file mtime follows the remote', (getEnv) => {
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

  it('[SPEC:MT-1] a text note and a binary file downloaded by a fresh device carry the remote 2020 mtime', async () => {
    const md = 'mt1-note.md';
    const png = 'mt1-image.png';
    await baseClient.uploadFile(md, textBuf('hello mtime\n'), MTIME_2020_SEC * 1000);
    await baseClient.uploadFile(png, bytesBuf(300), MTIME_2020_SEC * 1000);

    // Precondition: the server really kept the 2020 time, so the assertion below is about the download path.
    const listed = await baseClient.getFiles('');
    for (const p of [md, png]) {
      const f = listed.find((x) => x.path.endsWith(p));
      expect(f).toBeDefined();
      expect(Math.floor((f?.lastModified ?? 0) / 1000)).toBe(MTIME_2020_SEC);
    }

    const dev = makeDevice(getEnv(), ws.remoteBase, 'MT1-device');
    await dev.sync();

    expect(dev.vault.localExists(md)).toBe(true);
    expect(dev.vault.localExists(png)).toBe(true);
    const sMd = await dev.vault.adapter.stat(md);
    const sPng = await dev.vault.adapter.stat(png);
    expect(Math.floor((sMd?.mtime ?? 0) / 1000)).toBe(MTIME_2020_SEC); // [SPEC:MT-1] text write path
    expect(Math.floor((sPng?.mtime ?? 0) / 1000)).toBe(MTIME_2020_SEC); // [SPEC:MT-1] binary write path

    // The old mtime must not read as a local change: the next sync transfers nothing and writes nothing.
    await dev.sync();
    const s = dev.engine.getLastSessionSummary()!;
    expect(s.uploadedCount).toBe(0); // [SPEC:MT-6] no re-upload after the mtime-stamped download
    expect(s.downloadedCount).toBe(0); // [SPEC:MT-6] no re-download
    expect(Math.floor(((await dev.vault.adapter.stat(md))?.mtime ?? 0) / 1000)).toBe(MTIME_2020_SEC);
    expect(Math.floor(((await dev.vault.adapter.stat(png))?.mtime ?? 0) / 1000)).toBe(MTIME_2020_SEC);
  }, 180_000);
});
