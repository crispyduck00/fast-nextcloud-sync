import type { DataAdapter } from 'obsidian';
import { isValidCreationMs } from '../util/creationTime';

export const CREATION_TIME_SUPPORT = ['settable', 'readOnly', 'untrusted'] as const;
export type CreationTimeSupport = (typeof CREATION_TIME_SUPPORT)[number];

export const PROBE_CTIME_MS = Date.UTC(2001, 0, 1);
export const PROBE_MTIME_MS = Date.UTC(2002, 0, 1);

const TOLERANCE_MS = 2000;
const CREATED_RECENTLY_MS = 60000;

type ProbeAdapter = Pick<DataAdapter, 'write' | 'append' | 'stat' | 'remove' | 'exists'>;

/**
 * Classifies the platform once (docs/spec.md §9.7). Writes and removes `probePath`; never rejects.
 * @param now injected clock (tests)
 */
export async function probeCreationTimeSupport(
  adapter: ProbeAdapter,
  probePath: string,
  now: () => number = Date.now,
): Promise<CreationTimeSupport> {
  try {
    return await classify(adapter, probePath, now);
  } catch {
    return 'untrusted';
  } finally {
    try {
      if (await adapter.exists(probePath)) await adapter.remove(probePath);
    } catch {
      /* best effort */
    }
  }
}

async function classify(adapter: ProbeAdapter, probePath: string, now: () => number): Promise<CreationTimeSupport> {
  const t0 = now();
  await adapter.write(probePath, '');
  let appendFailed = false;
  try {
    await adapter.append(probePath, '', { ctime: PROBE_CTIME_MS, mtime: PROBE_MTIME_MS });
  } catch {
    appendFailed = true;
    try {
      await adapter.append(probePath, '', { mtime: PROBE_MTIME_MS });
    } catch {
      /* classified below */
    }
  }
  const s = await adapter.stat(probePath);
  if (!s) return 'untrusted';
  if (!appendFailed && Math.abs(s.ctime - PROBE_CTIME_MS) < TOLERANCE_MS) return 'settable';
  if (Math.abs(s.mtime - PROBE_MTIME_MS) >= TOLERANCE_MS) return 'untrusted';
  if (Math.abs(s.ctime - PROBE_MTIME_MS) < TOLERANCE_MS) return 'untrusted';
  if (isValidCreationMs(s.ctime) && Math.abs(s.ctime - t0) < CREATED_RECENTLY_MS) return 'readOnly';
  return 'untrusted';
}
