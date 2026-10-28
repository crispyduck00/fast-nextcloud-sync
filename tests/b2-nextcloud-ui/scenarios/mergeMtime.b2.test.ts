// Merge mtime on desktop (docs/spec.md §9.6): an automatic merge result is written locally and uploaded with one
// merge time, so the local mtime and the server lastModified are equal and both fall inside the sync window.
import { browser, expect } from '@wdio/globals';
import { requireUiEnv } from '../support/env';

const ui = requireUiEnv();
const PASSWORD_SECRET_ID = 'b2-merge-mtime-secret';
const stamp = `${process.pid}-${Date.now()}`;

describe('[merge-mtime] merge result carries one merge time on both sides (desktop)', function () {
  after(async function () {
    if (!ui.ok) return;
    await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['nextcloud-sync'];
      p.settings.watchOnChangeEnabled = true;
      await p.saveData?.(p.settings);
    });
  });

  it('[SPEC:MT-4] local mtime and server lastModified are equal and inside the sync window after an auto-merge', async function () {
    if (!ui.ok) this.skip();
    const path = `b2-merge-mtime-${stamp}.md`;
    const base = 'alpha\nbravo\ncharlie\n';
    const remoteEdit = 'ALPHA-REMOTE\nbravo\ncharlie\n';
    const localEdit = 'alpha\nbravo\nCHARLIE-LOCAL\n';

    const r = await browser.executeObsidian(
      async ({ app }, server: string, user: string, password: string, secretId: string, path: string, base: string, remoteEdit: string, localEdit: string) => {
        const p = (app as any).plugins.plugins['nextcloud-sync'];
        const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
        p.settings.serverUrl = server;
        p.settings.username = user;
        p.settings.passwordSecretId = secretId;
        // Only the explicit syncs below may run, so the merge happens inside the measured window.
        p.settings.watchOnChangeEnabled = false;
        app.secretStorage.setSecret(secretId, password);
        await p.saveData?.(p.settings);

        // Bring both sides to the same state.
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) await app.vault.delete(existing);
        await app.vault.create(path, base);
        await p.runSyncNow();
        const client = p.syncEngine.client;

        // Edit different lines on each side.
        await client.uploadFile(path, new TextEncoder().encode(remoteEdit).buffer, Date.now());
        const tfile = app.vault.getAbstractFileByPath(path) as any;
        await app.vault.modify(tfile, localEdit);
        // Let both edit times fall clearly before the window, and outside the recent-edit deferral.
        await sleep(2500);

        const t0 = Date.now();
        await p.runSyncNow();
        const t1 = Date.now();

        const st = await app.vault.adapter.stat(path);
        let cacheMtime: number | null = null;
        const f: any = app.vault.getAbstractFileByPath(path);
        if (f?.stat) cacheMtime = f.stat.mtime;
        const remote = await client.statFile(path);
        const remoteBody = new TextDecoder().decode(await client.downloadFile(path));
        return {
          t0,
          t1,
          localSec: st ? Math.floor(st.mtime / 1000) : null,
          cacheSec: cacheMtime === null ? null : Math.floor(cacheMtime / 1000),
          remoteSec: remote ? Math.floor(remote.lastModified / 1000) : null,
          localBody: await app.vault.adapter.read(path),
          remoteBody,
        };
      },
      ui.values.NEXTCLOUD_SERVER_URL,
      ui.values.NEXTCLOUD_USER,
      ui.values.NEXTCLOUD_PASSWORD,
      PASSWORD_SECRET_ID,
      path,
      base,
      remoteEdit,
      localEdit,
    );

    // The merge kept both edits, locally and on the server.
    expect(r.localBody).toContain('ALPHA-REMOTE');
    expect(r.localBody).toContain('CHARLIE-LOCAL');
    expect(r.remoteBody).toBe(r.localBody);

    const lo = Math.floor(r.t0 / 1000);
    const hi = Math.floor(r.t1 / 1000);
    // [SPEC:MT-4] both sides carry the merge time: inside [t0, t1] (seconds, Obsidian clock) and equal to each other.
    expect(r.localSec).not.toBeNull();
    expect(r.remoteSec).not.toBeNull();
    expect(r.localSec as number).toBeGreaterThanOrEqual(lo);
    expect(r.localSec as number).toBeLessThanOrEqual(hi);
    expect(r.remoteSec as number).toBeGreaterThanOrEqual(lo);
    expect(r.remoteSec as number).toBeLessThanOrEqual(hi);
    expect(r.remoteSec).toBe(r.localSec);
    if (r.cacheSec !== null) expect(r.cacheSec).toBe(r.localSec);
  });
});
