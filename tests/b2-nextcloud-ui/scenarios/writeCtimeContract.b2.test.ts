// Platform contract (desktop): the creation-time probe (docs/spec.md §9.7) classifies Linux desktop Obsidian as not
// settable, leaves no temporary file behind, and a sync with the feature in place (download, upload, write to a file
// open in a leaf) fails nothing and keeps the existing mtime behaviour.
import { browser, expect } from '@wdio/globals';
import { requireUiEnv } from '../support/env';

const ui = requireUiEnv();
const PASSWORD_SECRET_ID = 'b2-write-ctime-secret';
const REMOTE_MTIME_MS = Date.UTC(2020, 0, 1);
const REMOTE_MTIME_SEC = REMOTE_MTIME_MS / 1000;
const stamp = `${process.pid}-${Date.now()}`;

// Points the plugin at the test server and turns watch mode off so only the explicit syncs run. Runs inside Obsidian.
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

describe('[contract][writeCtime] creation time support on desktop', function () {
  after(async function () {
    if (!ui.ok) return;
    await restoreWatch();
  });

  it('[SPEC:CT-20] the probe result is not settable and leaves no temporary file', async function () {
    if (!ui.ok) this.skip();
    await configurePlugin();

    const r = await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['nextcloud-sync'];
      // Make sure the engine exists before reaching into its options.
      await p.runSyncNow();
      const support = await p.syncEngine.opts.localAdapter.creationTimeSupport();
      console.log(`[writeCtime] desktop creationTimeSupport=${support}`);
      const probePath = `${app.vault.configDir}/plugins/nextcloud-sync/.ctime-probe.ncs.tmp`;
      return { support: support as string, probeLeft: await app.vault.adapter.exists(probePath) };
    });

    expect(r.support).not.toBe('settable');
    expect(r.probeLeft).toBe(false);
  });

  it('[SPEC:CT-20] download, upload and a write to an open file sync without errors and keep the mtime', async function () {
    if (!ui.ok) this.skip();
    await configurePlugin();
    const dlPath = `b2-ctime-dl-${stamp}.md`;
    const upPath = `b2-ctime-up-${stamp}.md`;
    const openPath = `b2-ctime-open-${stamp}.md`;

    const r = await browser.executeObsidian(
      async ({ app }, dlPath: string, upPath: string, openPath: string, mtimeMs: number) => {
        const p = (app as any).plugins.plugins['nextcloud-sync'];
        const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
        const enc = (s: string) => new TextEncoder().encode(s).buffer;
        const errors: number[] = [];
        const sync = async () => {
          await p.runSyncNow();
          errors.push(p.syncEngine.getLastSessionSummary()?.errorCount ?? -1);
        };
        const cacheSecOf = async (path: string, wantSec: number) => {
          let sec: number | null = null;
          for (let i = 0; i < 50; i++) {
            const f: any = app.vault.getAbstractFileByPath(path);
            sec = f?.stat ? Math.floor(f.stat.mtime / 1000) : null;
            if (sec === wantSec) break;
            await sleep(200);
          }
          return sec;
        };

        await sync();
        // Download: a server-only file with an old mtime.
        await p.syncEngine.client.uploadFile(dlPath, enc('remote body'), mtimeMs);
        // Upload: a local-only file.
        const existingUp = app.vault.getAbstractFileByPath(upPath);
        if (existingUp) await app.vault.delete(existingUp);
        await app.vault.create(upPath, 'local body');
        // Open file: create, sync, open in a leaf, then change only the server side.
        const existingOpen = app.vault.getAbstractFileByPath(openPath);
        if (existingOpen) await app.vault.delete(existingOpen);
        await app.vault.create(openPath, 'open original');
        await sync();
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(app.vault.getAbstractFileByPath(openPath));
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await p.syncEngine.client.uploadFile(openPath, enc('open remote'), mtimeMs);
        await sync();

        const dlSt = await app.vault.adapter.stat(dlPath);
        const openSt = await app.vault.adapter.stat(openPath);
        return {
          errors,
          dlContent: await app.vault.adapter.read(dlPath),
          dlAdapterSec: dlSt ? Math.floor(dlSt.mtime / 1000) : null,
          dlCacheSec: await cacheSecOf(dlPath, mtimeMs / 1000),
          upExists: await app.vault.adapter.exists(upPath),
          openContent: await app.vault.adapter.read(openPath),
          openAdapterSec: openSt ? Math.floor(openSt.mtime / 1000) : null,
          openCacheSec: await cacheSecOf(openPath, mtimeMs / 1000),
          leafStillOpen: (app.workspace.getLeavesOfType('markdown') as any[]).some(
            (l) => l.view?.file?.path === openPath,
          ),
        };
      },
      dlPath,
      upPath,
      openPath,
      REMOTE_MTIME_MS,
    );

    expect(r.errors.every((n) => n === 0)).toBe(true);
    expect(r.dlContent).toBe('remote body');
    expect(r.dlAdapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.dlCacheSec).toBe(REMOTE_MTIME_SEC);
    expect(r.upExists).toBe(true);
    expect(r.openContent).toBe('open remote');
    expect(r.openAdapterSec).toBe(REMOTE_MTIME_SEC);
    expect(r.openCacheSec).toBe(REMOTE_MTIME_SEC);
    expect(r.leafStillOpen).toBe(true);
  });
});
