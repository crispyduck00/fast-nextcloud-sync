// Platform contract (Android): the creation-time probe (docs/spec.md §9.7) result is recorded in the log, leaves no
// temporary file behind, and a download keeps the server creation time when the result is 'settable'. For any other
// result the download must still sync without failing.
import { browser, expect } from '@wdio/globals';
import { requireAndroidEnv, requireEnvOrSkip } from '../support/env';
import { seedConnection } from '../support/plugin';
import { RemoteProbe, davUrl } from '../support/webdav';

const env = requireAndroidEnv();
const stamp = `b3-ctime-${process.pid}`;
const REMOTE_CTIME_MS = Date.UTC(2019, 0, 1);
const REMOTE_MTIME_SEC = Date.UTC(2020, 0, 1) / 1000;

// PUT with X-OC-CTime and X-OC-MTime; RemoteProbe.put cannot set extra headers, so this talks to the server in Node.
async function putWithTimes(vaultName: string, path: string, body: Buffer, ctimeMs: number): Promise<number> {
  const { NEXTCLOUD_SERVER_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD } = env.values;
  const base = `${NEXTCLOUD_SERVER_URL.replace(/\/$/, '')}/${encodeURIComponent(vaultName)}/`;
  const auth = `Basic ${Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;
  const res = await fetch(davUrl(base, path), {
    method: 'PUT',
    headers: {
      Authorization: auth,
      'X-OC-MTime': String(REMOTE_MTIME_SEC),
      'X-OC-CTime': String(Math.floor(ctimeMs / 1000)),
    },
    body: body as unknown as BodyInit,
  });
  return res.status;
}

describe('[contract][writeCtime] creation time support on Android', function () {
  let probe: RemoteProbe | undefined;
  let vaultName = '';
  let support = '';
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

  it('[SPEC:CT-21] the probe result is recorded and leaves no temporary file', async function () {
    const r = (await browser.executeObsidian(async ({ app }) => {
      const p = (app as any).plugins.plugins['nextcloud-sync'];
      await p.runSyncNow();
      const result = await p.syncEngine.opts.localAdapter.creationTimeSupport();
      console.log(`[writeCtime] android creationTimeSupport=${result}`);
      const probePath = `${app.vault.configDir}/plugins/nextcloud-sync/.ctime-probe.ncs.tmp`;
      return { support: result as string, probeLeft: await app.vault.adapter.exists(probePath) };
    })) as { support: string; probeLeft: boolean };
    support = r.support;
    // Recorded for the reader of the test log (the value is a platform observation, not an expectation).
    console.log(`[writeCtime] android creationTimeSupport=${support}`);
    expect(['settable', 'readOnly', 'untrusted']).toContain(support);
    expect(r.probeLeft).toBe(false);
  });

  it('[SPEC:CT-21] a downloaded file keeps the server creation time when settable, and the sync never fails', async function () {
    const name = `${stamp}-note.md`;
    created.push(name);
    const status = await putWithTimes(vaultName, name, Buffer.from('remote note\n', 'utf-8'), REMOTE_CTIME_MS);
    expect([201, 204]).toContain(status);

    await browser.executeObsidianCommand('nextcloud-sync:sync-now');
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(({ app }, p: string) => app.vault.adapter.exists(p), name)) as boolean,
      { timeout: 120_000, interval: 3_000, timeoutMsg: `"${name}" never arrived from the server` },
    );

    const r = (await browser.executeObsidian(async ({ app }, p: string) => {
      const plugin = (app as any).plugins.plugins['nextcloud-sync'];
      const st = await app.vault.adapter.stat(p);
      return {
        ctime: st ? st.ctime : null,
        errorCount: plugin.syncEngine.getLastSessionSummary()?.errorCount ?? -1,
      };
    }, name)) as { ctime: number | null; errorCount: number };

    expect(r.errorCount).toBe(0);
    if (support === 'settable') {
      expect(r.ctime).not.toBeNull();
      expect(Math.abs((r.ctime as number) - REMOTE_CTIME_MS)).toBeLessThan(1000);
    }
  });
});
