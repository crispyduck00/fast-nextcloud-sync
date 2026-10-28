// Layer B1 — creation time on uploads (docs/spec.md §9.7): PUT and chunked upload against a real Nextcloud.
import { NextcloudClient } from '../../../src/network/NextcloudClient';
import { describeLive } from '../support/env';
import { cleanupWorkspace, IsolatedWorkspace } from '../support/isolation';
import { setupWorkspace } from '../support/workspace';
import { bytesBuf, textBuf, MB, uniquePath } from '../support/helpers';

const CHUNK = 10 * MB; // matches ChunkedUploadStrategy's fixed CHUNK_SIZE_BYTES

interface Exchange {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
}

// Wraps globalThis.fetch (which the b1 obsidian mock's requestUrl calls on every request) and records the request
// headers and the response headers too, which the shared recorder does not keep.
function recordExchanges(): { exchanges: Exchange[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const exchanges: Exchange[] = [];
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const init = args[1];
    const res = await originalFetch(...args);
    const requestHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) requestHeaders[k.toLowerCase()] = String(v);
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });
    exchanges.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: typeof args[0] === 'string' ? args[0] : String(args[0]),
      requestHeaders,
      responseHeaders,
    });
    return res;
  }) as typeof fetch;
  return { exchanges, restore: () => { globalThis.fetch = originalFetch; } };
}

describeLive('Layer B1 — creation time on upload (CT)', (getEnv) => {
  let ws: IsolatedWorkspace;
  let client: NextcloudClient;

  beforeAll(async () => {
    const s = await setupWorkspace(getEnv());
    ws = s.ws;
    client = s.client;
  });

  afterAll(async () => {
    if (client && ws) await cleanupWorkspace(client, ws);
  });

  async function creationTimeOf(path: string): Promise<number | undefined> {
    return (await client.getFiles('')).find((f) => f.path === path)?.creationTime;
  }

  it('[SPEC:CT-15] PUT with ctime is accepted, and the creation time survives an overwrite and a rename', async () => {
    const T = 1_600_000_000_123; // 2020-09-13, well above the one-day floor
    const mtime = 1_700_000_000_000;
    const path = uniquePath('ct15');
    const renamed = uniquePath('ct15-renamed');
    const rec = recordExchanges();
    try {
      await client.uploadFile(path, textBuf('first'), mtime, { ctime: T });

      const put = rec.exchanges.filter((e) => e.method === 'PUT' && e.url.endsWith(encodeURI(path)));
      expect(put).toHaveLength(1);
      expect(put[0].requestHeaders['x-oc-ctime']).toBe('1600000000');
      expect(put[0].responseHeaders['x-oc-ctime']).toBe('accepted');
    } finally {
      rec.restore();
    }
    expect(await creationTimeOf(path)).toBe(1_600_000_000_000);

    // An overwrite without ctime must not move the creation time.
    await client.uploadFile(path, textBuf('second, longer'), mtime + 5000);
    expect(await creationTimeOf(path)).toBe(1_600_000_000_000);

    // A rename keeps the file, so the creation time stays.
    await client.moveFile(path, renamed);
    expect(await creationTimeOf(renamed)).toBe(1_600_000_000_000);
    const listed = (await client.getFiles('')).find((f) => f.path === renamed);
    expect(listed?.creationTime).toBe(1600000000 * 1000);
  });

  it('[SPEC:CT-16] chunked upload sets both mtime and creation time, completing what the MOVE did not accept', async () => {
    const M = 1_700_000_000_000;
    const C = 1_600_000_000_000;
    const path = uniquePath('ct16', 'bin');
    const rec = recordExchanges();
    try {
      await client.uploadChunked(path, bytesBuf(11 * MB), CHUNK, { mtime: M, ctime: C });

      const move = rec.exchanges.find((e) => e.method === 'MOVE' && e.requestHeaders['destination']?.endsWith(encodeURI(path)));
      expect(move).toBeDefined();
      const mtimeAccepted = move!.responseHeaders['x-oc-mtime'] === 'accepted';
      const ctimeAccepted = move!.responseHeaders['x-oc-ctime'] === 'accepted';
      // Recorded for the documentation of docs/spec.md §18.
      console.log(`[CT-16] assembling MOVE: X-OC-MTime accepted=${mtimeAccepted}, X-OC-CTime accepted=${ctimeAccepted}`);

      // The attributes the MOVE did not acknowledge are completed by exactly one PROPPATCH; none when both were accepted.
      const proppatches = rec.exchanges.filter((e) => e.method === 'PROPPATCH' && e.url.endsWith(encodeURI(path)));
      if (mtimeAccepted && ctimeAccepted) expect(proppatches).toHaveLength(0);
      else expect(proppatches).toHaveLength(1);
    } finally {
      rec.restore();
    }

    const info = (await client.getFiles('')).find((f) => f.path === path);
    expect(info).toBeDefined();
    expect(Math.floor(info!.lastModified / 1000)).toBe(Math.floor(M / 1000));
    expect(info!.creationTime).toBe(Math.floor(C / 1000) * 1000);
  });
});
