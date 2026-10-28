// Platform contract (Android): Obsidian applies DataWriteOptions.mtime on writeBinary and modifyBinary, and the vault
// cache reports it. docs/spec.md §9.6 relies on this; a failure here means the platform stopped honouring the option.
import { browser, expect } from '@wdio/globals';
import { requireAndroidEnv, requireEnvOrSkip } from '../support/env';

const env = requireAndroidEnv();

// Contract: DataWriteOptions.mtime survives writeBinary -> remove -> rename, and the vault cache picks it up.
const T = Date.UTC(2020, 0, 1);
const EXPECTED_SEC = T / 1000;
const stamp = `contract-write-mtime-${process.pid}`;

type WriteResult = {
  adapterSec: number | null;
  cache: { status: 'ok' | 'not-indexed' | 'mismatch'; actualSec: number | null };
};

// Runs inside Obsidian. `mode` selects the replace path: 'rename' (normal) or 'modify' (open-leaf path).
async function runWrite(mode: 'rename' | 'modify', target: string, tmp: string, mtime: number): Promise<WriteResult> {
  return browser.executeObsidian(
    async ({ app }, mode: string, target: string, tmp: string, mtime: number) => {
      const adapter = app.vault.adapter;
      const data = new TextEncoder().encode('contract payload').buffer;
      const expectedSec = mtime / 1000;
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      try {
        if (mode === 'rename') {
          await adapter.writeBinary(tmp, data, { mtime });
          if (await adapter.exists(target)) await adapter.remove(target);
          await adapter.rename(tmp, target);
        } else {
          // Seed an existing file, wait until the vault indexes it, then modify it in place.
          await adapter.writeBinary(target, new TextEncoder().encode('seed').buffer);
          for (let i = 0; i < 50 && !app.vault.getAbstractFileByPath(target); i++) await sleep(200);
          const tfile = app.vault.getAbstractFileByPath(target);
          if (!tfile) return { adapterSec: null, cache: { status: 'not-indexed', actualSec: null } };
          await app.vault.modifyBinary(tfile as any, data, { mtime });
        }
        const st = await adapter.stat(target);
        const adapterSec = st ? Math.floor(st.mtime / 1000) : null;

        // Poll the vault cache every 200 ms for up to 10 s until the TFile exists and its mtime matches.
        let cache: { status: 'ok' | 'not-indexed' | 'mismatch'; actualSec: number | null } = {
          status: 'not-indexed',
          actualSec: null,
        };
        for (let i = 0; i < 50; i++) {
          const f = app.vault.getAbstractFileByPath(target) as any;
          if (f && f.stat) {
            const actualSec = Math.floor(f.stat.mtime / 1000);
            cache = { status: actualSec === expectedSec ? 'ok' : 'mismatch', actualSec };
            if (cache.status === 'ok') break;
          }
          await sleep(200);
        }
        return { adapterSec, cache };
      } finally {
        for (const p of [target, tmp]) {
          if (await adapter.exists(p)) await adapter.remove(p);
        }
      }
    },
    mode,
    target,
    tmp,
    mtime,
  ) as Promise<WriteResult>;
}

function assertCache(r: WriteResult, path: string): void {
  if (r.cache.status === 'not-indexed') throw new Error(`not indexed within 10s: ${path}`);
  if (r.cache.status === 'mismatch') {
    throw new Error(`mtime mismatch: expected ${EXPECTED_SEC}, got ${r.cache.actualSec}`);
  }
}

describe('[contract][writeMtime] DataWriteOptions.mtime on Android', function () {
  before(async function () {
    requireEnvOrSkip(this);
  });

  it('[contract][writeMtime] adapter stat keeps mtime after writeBinary, remove, rename', async function () {
    const target = `${stamp}-1.bin`;
    const r = await runWrite('rename', target, `${target}.tmp`, T);
    expect(r.adapterSec).toBe(EXPECTED_SEC);
  });

  it('[contract][writeMtime] vault cache keeps mtime after writeBinary, remove, rename', async function () {
    const target = `${stamp}-2.bin`;
    const r = await runWrite('rename', target, `${target}.tmp`, T);
    assertCache(r, target);
  });

  it('[contract][writeMtime] adapter stat keeps mtime after modifyBinary on an existing file', async function () {
    const target = `${stamp}-3.bin`;
    const r = await runWrite('modify', target, `${target}.tmp`, T);
    expect(r.adapterSec).toBe(EXPECTED_SEC);
  });

  it('[contract][writeMtime] vault cache keeps mtime after modifyBinary on an existing file', async function () {
    const target = `${stamp}-4.bin`;
    const r = await runWrite('modify', target, `${target}.tmp`, T);
    assertCache(r, target);
  });
});
