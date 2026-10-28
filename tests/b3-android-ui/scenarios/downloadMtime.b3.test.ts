// [SPEC:MT-1] A file downloaded on Android keeps the remote modification time (docs/spec.md §9.6).
// Android used to ignore the mtime, so a downloaded note carried the time of the sync. The server fixtures are
// stored with X-OC-MTime = 2020-01-01T00:00:00Z; both the adapter stat and the vault cache must report that time.
import { browser, expect } from '@wdio/globals';
import { requireAndroidEnv, requireEnvOrSkip } from '../support/env';
import { seedConnection } from '../support/plugin';
import { RemoteProbe, davUrl } from '../support/webdav';

const env = requireAndroidEnv();
const stamp = `b3-dl-mtime-${process.pid}`;
const REMOTE_MTIME_SEC = Date.UTC(2020, 0, 1) / 1000; // 1577836800

// PUT with X-OC-MTime; RemoteProbe.put cannot set extra headers, so this talks to the server directly in Node.
async function putWithMtime(vaultName: string, path: string, body: Buffer, mtimeSec: number): Promise<number> {
  const { NEXTCLOUD_SERVER_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD } = env.values;
  const base = `${NEXTCLOUD_SERVER_URL.replace(/\/$/, '')}/${encodeURIComponent(vaultName)}/`;
  const auth = `Basic ${Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;
  const res = await fetch(davUrl(base, path), {
    method: 'PUT',
    headers: { Authorization: auth, 'X-OC-MTime': String(mtimeSec) },
    body: body as unknown as BodyInit,
  });
  return res.status;
}

type Observed = { exists: boolean; adapterSec: number | null; cacheSec: number | null };

// Runs inside Obsidian: waits for the file and its vault-cache entry, then reports both mtimes in whole seconds.
async function observe(path: string): Promise<Observed> {
  return browser.executeObsidian(
    async ({ app }, p: string) => {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      for (let i = 0; i < 50 && !(await app.vault.adapter.exists(p)); i++) await sleep(200);
      if (!(await app.vault.adapter.exists(p))) return { exists: false, adapterSec: null, cacheSec: null };
      const st = await app.vault.adapter.stat(p);
      // The vault cache is filled asynchronously after the write; give it up to 10 s to index the file.
      let file = app.vault.getFileByPath(p);
      for (let i = 0; i < 50 && !file; i++) {
        await sleep(200);
        file = app.vault.getFileByPath(p);
      }
      return {
        exists: true,
        adapterSec: st ? Math.floor(st.mtime / 1000) : null,
        cacheSec: file ? Math.floor(file.stat.mtime / 1000) : null,
      };
    },
    path,
  ) as Promise<Observed>;
}

describe('[SPEC:MT-1] b-3 — downloaded files keep the remote mtime on Android', function () {
  let probe: RemoteProbe | undefined;
  let vaultName = '';
  const created: string[] = [];

  before(async function () {
    requireEnvOrSkip(this);
    vaultName = (await browser.executeObsidian(({ app }) => app.vault.getName())) as string;
    probe = await RemoteProbe.forCurrentVault();
    await seedConnection(env.values.NEXTCLOUD_SERVER_URL, env.values.NEXTCLOUD_USER, env.values.NEXTCLOUD_PASSWORD);
  });

  after(async function () {
    if (!probe) return;
    for (const p of created) await probe.removeQuietly(p);
  });

  async function downloadAndObserve(name: string, body: Buffer): Promise<Observed> {
    created.push(name);
    const status = await putWithMtime(vaultName, name, body, REMOTE_MTIME_SEC);
    expect([201, 204]).toContain(status);

    await browser.executeObsidianCommand('nextcloud-sync:sync-now');
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(({ app }, p: string) => app.vault.adapter.exists(p), name)) as boolean,
      { timeout: 120_000, interval: 3_000, timeoutMsg: `"${name}" never arrived from the server` },
    );
    return observe(name);
  }

  it('[SPEC:MT-1] a downloaded text note carries the remote mtime in the adapter and in the vault cache', async function () {
    const r = await downloadAndObserve(`${stamp}-note.md`, Buffer.from('remote note\n', 'utf-8'));
    expect(r.exists).toBe(true);
    expect(r.adapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.cacheSec).toBe(REMOTE_MTIME_SEC);
  });

  it('[SPEC:MT-1] a downloaded binary file carries the remote mtime in the adapter and in the vault cache', async function () {
    // Every byte value 0..255, so the binary write path is exercised with non-text content.
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const r = await downloadAndObserve(`${stamp}-image.png`, bytes);
    expect(r.exists).toBe(true);
    expect(r.adapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.cacheSec).toBe(REMOTE_MTIME_SEC);
  });
});
