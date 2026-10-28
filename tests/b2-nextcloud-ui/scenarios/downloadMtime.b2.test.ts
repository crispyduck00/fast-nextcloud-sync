// Download mtime on desktop (docs/spec.md §9.6): a file fetched from the remote gets the remote mtime,
// both for a closed file (adapter write path) and for a file open in a leaf (Vault.modify path).
import { browser, expect } from '@wdio/globals';
import { requireUiEnv } from '../support/env';

const ui = requireUiEnv();
const PASSWORD_SECRET_ID = 'b2-download-mtime-secret';
const REMOTE_MTIME_MS = Date.UTC(2020, 0, 1); // 2020-01-01T00:00:00Z
const REMOTE_MTIME_SEC = 1577836800;
const stamp = `${process.pid}-${Date.now()}`;

// Points the plugin at the test server, turns watch mode off (so only the explicit syncs below run) and
// returns nothing. Runs inside Obsidian.
async function configurePlugin(): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, server: string, user: string, password: string, secretId: string) => {
      const p = (app as any).plugins.plugins['nextcloud-sync'];
      p.settings.serverUrl = server;
      p.settings.username = user;
      p.settings.passwordSecretId = secretId;
      p.settings.watchOnChangeEnabled = false;
      app.secretStorage.setSecret(secretId, password);
      await p.saveData?.(p.settings);
    },
    ui.values.NEXTCLOUD_SERVER_URL,
    ui.values.NEXTCLOUD_USER,
    ui.values.NEXTCLOUD_PASSWORD,
    PASSWORD_SECRET_ID,
  );
}

async function restoreWatch(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const p = (app as any).plugins.plugins['nextcloud-sync'];
    p.settings.watchOnChangeEnabled = true;
    await p.saveData?.(p.settings);
  });
}

describe('[download-mtime] remote mtime is applied to the local file on desktop', function () {
  after(async function () {
    if (!ui.ok) return;
    await restoreWatch();
  });

  it('[SPEC:MT-1] a file that is not open gets the remote mtime after the sync download', async function () {
    if (!ui.ok) this.skip();
    const path = `b2-dl-mtime-closed-${stamp}.md`;
    await configurePlugin();

    const r = await browser.executeObsidian(
      async ({ app }, path: string, mtimeMs: number) => {
        const p = (app as any).plugins.plugins['nextcloud-sync'];
        const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
        // Make sure the engine and client exist, then place the file on the server with an old X-OC-MTime.
        await p.runSyncNow();
        const data = new TextEncoder().encode('remote body (closed file)').buffer;
        await p.syncEngine.client.uploadFile(path, data, mtimeMs);
        await p.runSyncNow();

        const st = await app.vault.adapter.stat(path);
        let tfile: any = null;
        for (let i = 0; i < 50 && !tfile; i++) {
          tfile = app.vault.getAbstractFileByPath(path);
          if (!tfile) await sleep(200);
        }
        // The vault cache can lag behind the disk; poll until it reports the expected second.
        let cacheSec: number | null = tfile?.stat ? Math.floor(tfile.stat.mtime / 1000) : null;
        for (let i = 0; i < 50 && cacheSec !== mtimeMs / 1000; i++) {
          await sleep(200);
          const f: any = app.vault.getAbstractFileByPath(path);
          cacheSec = f?.stat ? Math.floor(f.stat.mtime / 1000) : null;
        }
        const content = st ? await app.vault.adapter.read(path) : null;
        return { adapterSec: st ? Math.floor(st.mtime / 1000) : null, cacheSec, content };
      },
      path,
      REMOTE_MTIME_MS,
    );

    expect(r.content).toBe('remote body (closed file)');
    // [SPEC:MT-1] adapter stat and the vault cache both carry the remote mtime (second precision).
    expect(r.adapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.cacheSec).toBe(REMOTE_MTIME_SEC);
  });

  it('[SPEC:MT-2] a file open in a leaf gets the remote mtime and the leaf stays open', async function () {
    if (!ui.ok) this.skip();
    const path = `b2-dl-mtime-open-${stamp}.md`;
    const original = 'original content (open file)';
    const remoteBody = 'remote content (open file)\nsecond line';
    await configurePlugin();

    // Create locally and sync so both sides agree.
    await browser.executeObsidian(
      async ({ app }, path: string, content: string) => {
        const p = (app as any).plugins.plugins['nextcloud-sync'];
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) await app.vault.delete(existing);
        await app.vault.create(path, content);
        await p.runSyncNow();
      },
      path,
      original,
    );

    const leafId = await browser.executeObsidian(async ({ app }, path: string) => {
      const file = app.vault.getAbstractFileByPath(path);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      return app.workspace.activeLeaf?.id ?? null;
    }, path);
    expect(leafId).not.toBeNull();

    // Change only the server side: new content with an old mtime, then sync.
    const r = await browser.executeObsidian(
      async ({ app }, id: string, path: string, body: string, mtimeMs: number) => {
        const p = (app as any).plugins.plugins['nextcloud-sync'];
        const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
        await p.syncEngine.client.uploadFile(path, new TextEncoder().encode(body).buffer, mtimeMs);
        await p.runSyncNow();

        const st = await app.vault.adapter.stat(path);
        let cacheSec: number | null = null;
        for (let i = 0; i < 50; i++) {
          const f: any = app.vault.getAbstractFileByPath(path);
          cacheSec = f?.stat ? Math.floor(f.stat.mtime / 1000) : null;
          if (cacheSec === mtimeMs / 1000) break;
          await sleep(200);
        }
        const leaf = app.workspace.getLeafById(id);
        const file = leaf?.view && (leaf.view as any).file;
        return {
          content: await app.vault.adapter.read(path),
          adapterSec: st ? Math.floor(st.mtime / 1000) : null,
          cacheSec,
          leafSurvived: !!leaf,
          stillShowingNote: file?.path === path,
        };
      },
      leafId as string,
      path,
      remoteBody,
      REMOTE_MTIME_MS,
    );

    expect(r.content).toBe(remoteBody);
    // [SPEC:MT-2] the Vault.modify path applies the same remote mtime.
    expect(r.adapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.cacheSec).toBe(REMOTE_MTIME_SEC);
    expect(r.leafSurvived).toBe(true);
    expect(r.stillShowingNote).toBe(true);
  });
});
