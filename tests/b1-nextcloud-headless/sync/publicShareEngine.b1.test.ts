// Layer B — full SyncEngine through a public link share (legacy and token URL forms): the Depth: infinity listing
// with the root-ETag short-circuit (SD-8) and no re-download of a file the engine just uploaded (SD-10).
import { Platform } from 'obsidian';
import { describeLive, LiveEnv } from '../support/env';
import { setupWorkspace, ensureParentDirs } from '../support/workspace';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { makeDevice } from '../support/engineDevice';
import { makeClient } from '../support/clientFactory';
import { textBuf, MB } from '../support/helpers';
import { FeatureUnsupportedError } from '../../../src/types';
import { createPublicShare, deletePublicShare, publicShareEnv, PublicShare } from '../support/publicShare';
import { recordRequests } from '../support/requestRecorder';

describeLive('Layer B — public share engine sync', (getEnv) => {
  let ws: IsolatedWorkspace;
  let adminClient: NextcloudClient;
  let share: PublicShare | undefined;

  beforeAll(async () => {
    const env = getEnv();
    const s = await setupWorkspace(env);
    ws = s.ws;
    adminClient = s.client;
    share = await createPublicShare(env, ws.remoteBase);
    await ensureParentDirs(env, ws, 'vault-legacy/x.md');
    await ensureParentDirs(env, ws, 'vault-token/x.md');
  }, 120_000);

  afterAll(async () => {
    if (share) await deletePublicShare(getEnv(), share);
    if (adminClient && ws) await cleanupWorkspace(adminClient, ws);
  }, 120_000);

  afterEach(() => {
    Platform.isMobile = false;
  });

  describe.each(['legacy', 'token'] as const)('%s form', (form) => {
    const remoteBase = `vault-${form}`;
    const shareEnvOf = (): LiveEnv => publicShareEnv(getEnv(), share as PublicShare, form);

    it('[SPEC:SD-8] syncs with the Depth: infinity listing and skips the full scan on an unchanged root ETag', async () => {
      const shareEnv = shareEnvOf();
      const rec = recordRequests();
      let device: ReturnType<typeof makeDevice>;
      try {
        device = makeDevice(shareEnv, remoteBase, `sd8-${form}`);
        device.vault.seedLocal('a.md', 'alpha\n');
        device.vault.seedLocal('sub/b.md', 'bravo\n');
        device.vault.seedLocal('sub/deep/c.md', 'charlie\n');
        await device.sync();
        // A public share must never send the login-like OCS capabilities request: the server counts it as a
        // failed login and throttles the sender with HTTP 429 (docs/spec.md §3).
        expect(rec.requests.filter((r) => r.url.includes('/ocs/'))).toHaveLength(0);

        rec.clear();
        await device.sync();
        const second = rec.requests.filter((r) => r.method === 'PROPFIND');
        expect(second.filter((r) => r.depth === '1')).toHaveLength(0);
        expect(second.filter((r) => r.depth === 'infinity').length).toBeGreaterThanOrEqual(1);

        rec.clear();
        await device.sync();
        const third = rec.requests.filter((r) => r.method === 'PROPFIND');
        expect(third.filter((r) => r.depth === 'infinity')).toHaveLength(0);
        expect(third.filter((r) => r.depth === '0').length).toBeGreaterThanOrEqual(1);
        expect(device.stateDB.getFullScanSkipCount()).toBe(1);
      } finally {
        rec.restore();
      }

      const c = makeClient(shareEnv, remoteBase);
      await c.connect();
      await c.uploadFile('remote.md', textBuf('from server'));
      await device.sync();
      expect(device.vault.readLocal('remote.md')).toBe('from server');
    }, 180_000);

    it('[SPEC:SD-9] sends nothing to the uploads/versions namespaces and no LOCK; a file above the chunk threshold uploads in one PUT', async () => {
      // Platform must be switched before the engine exists: ensureClient picks the 20 MB-threshold strategy then.
      Platform.isMobile = true;
      const shareEnv = shareEnvOf();
      const device = makeDevice(shareEnv, remoteBase, `sd9-${form}`);
      device.vault.seedLocal('big.md', 'x'.repeat(21 * MB));
      const rec = recordRequests();
      try {
        await device.sync();
        expect(rec.requests.filter((r) => r.url.includes('/remote.php/dav/uploads/'))).toHaveLength(0);
        expect(rec.requests.filter((r) => r.url.includes('/remote.php/dav/versions/'))).toHaveLength(0);
        expect(rec.requests.filter((r) => r.method === 'LOCK')).toHaveLength(0);

        const c = makeClient(shareEnv, remoteBase);
        await c.connect();
        expect((await c.downloadFile('big.md')).byteLength).toBe(21 * MB);

        rec.clear();
        await expect(device.engine.listVersions('big.md')).rejects.toBeInstanceOf(FeatureUnsupportedError);
        expect(rec.requests).toHaveLength(0);
      } finally {
        rec.restore();
      }
    }, 180_000);

    it('[SPEC:SD-10] the next sync does not re-download a file it just uploaded through the share', async () => {
      const device = makeDevice(shareEnvOf(), remoteBase, `sd10-${form}`);
      device.vault.seedLocal('fresh.md', `fresh ${form}\n`);
      await device.sync();

      const spy = jest.spyOn(device.client, 'downloadFile');
      await device.sync();
      expect(spy).not.toHaveBeenCalled();
    }, 120_000);
  });
});
