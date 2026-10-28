// Layer B — an automatic merge (and a conflict-marker write) uses ONE merge time as the local mtime and as the upload's
// X-OC-MTime (docs/spec.md §9.6). Desktop (D) edits a line and syncs; mobile (M) edited another line (or the same
// line) of the same note, then syncs: that sync runs resolveByWrite. All comparisons are at second precision.
import { describeLive } from '../support/env';
import { setupWorkspace } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { makeDevice, Device } from '../support/engineDevice';

const sec = (ms: number | undefined): number => Math.floor((ms ?? 0) / 1000);

describeLive('Layer B — merge write mtime', (getEnv) => {
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

  async function remoteMtime(path: string): Promise<number | undefined> {
    return (await baseClient.getFiles('')).find((f) => f.path.endsWith(path))?.lastModified;
  }

  // Seeds both devices with the same base, lets D push `dBody`, gives M the local edit `mBody`, then times M's sync.
  async function mergeRound(
    tag: string, base: string, dBody: string, mBody: string,
  ): Promise<{ d: Device; m: Device; t0: number; t1: number }> {
    const over = { autoMergeFileStrategy: 'merge' as const };
    const d = makeDevice(getEnv(), ws.remoteBase, `D-${tag}`, over);
    const m = makeDevice(getEnv(), ws.remoteBase, `M-${tag}`, { ...over, syncIntervalMinutes: 0, watchOnChangeEnabled: false });
    const f = `${tag}.md`;
    d.vault.seedLocal('anchor.md', 'anchor'); // keeps the folder non-empty across the run
    d.vault.seedLocal(f, base);
    await d.sync();
    await m.sync();
    expect(m.vault.readLocal(f)).toBe(base);
    d.vault.seedLocal(f, dBody);
    await d.sync();
    m.vault.seedLocal(f, mBody);
    const t0 = Date.now();
    await m.sync();
    const t1 = Date.now();
    return { d, m, t0, t1 };
  }

  it('[SPEC:MT-4] a clean auto-merge stamps local and server with the same merge time inside the sync window', async () => {
    const f = 'mt4merge.md';
    const { m, t0, t1 } = await mergeRound('mt4merge', 'alpha\nbravo\ncharlie\n', 'ALPHA-D\nbravo\ncharlie\n', 'alpha\nbravo\nCHARLIE-M\n');
    const body = m.vault.readLocal(f)!;
    expect(body).toContain('ALPHA-D');
    expect(body).toContain('CHARLIE-M');
    expect(body).not.toContain('<<<<<<<');

    const local = sec((await m.vault.adapter.stat(f))?.mtime);
    const server = sec(await remoteMtime(f));
    expect(local).toBeGreaterThanOrEqual(sec(t0)); // [SPEC:MT-4] local inside the window
    expect(local).toBeLessThanOrEqual(sec(t1));
    expect(server).toBeGreaterThanOrEqual(sec(t0)); // [SPEC:MT-4] server inside the window
    expect(server).toBeLessThanOrEqual(sec(t1));
    expect(local).toBe(server); // [SPEC:MT-4] one merge time on both sides
  }, 180_000);

  it('[SPEC:MT-4] a conflict-marker write (same line edited on both sides) also uses one merge time', async () => {
    const f = 'mt4marker.md';
    const { m, t0, t1 } = await mergeRound('mt4marker', 'alpha\nbravo\ncharlie\n', 'alpha\nBRAVO-D\ncharlie\n', 'alpha\nBRAVO-M\ncharlie\n');
    const body = m.vault.readLocal(f)!;
    expect(body).toContain('BRAVO-D');
    expect(body).toContain('BRAVO-M');
    expect(body).toMatch(/^<<<<<<< LOCAL/m);

    const local = sec((await m.vault.adapter.stat(f))?.mtime);
    const server = sec(await remoteMtime(f));
    expect(local).toBeGreaterThanOrEqual(sec(t0)); // [SPEC:MT-4]
    expect(local).toBeLessThanOrEqual(sec(t1));
    expect(server).toBeGreaterThanOrEqual(sec(t0));
    expect(server).toBeLessThanOrEqual(sec(t1));
    expect(local).toBe(server);
  }, 180_000);
});
