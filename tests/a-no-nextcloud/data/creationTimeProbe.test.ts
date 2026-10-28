// [SPEC:CT-10] The platform probe classifies creation-time support as settable / readOnly / untrusted.
import type { DataAdapter } from 'obsidian';
import {
  probeCreationTimeSupport,
  PROBE_CTIME_MS,
  PROBE_MTIME_MS,
  CREATION_TIME_SUPPORT,
} from '../../../src/data/creationTimeProbe';
import { spec } from '../support/specRef';

const NOW = Date.UTC(2026, 9, 1);
const PROBE_PATH = '.obsidian/plugins/x/.ctime-probe.ncs.tmp';

interface Behavior {
  /** append with ctime: 'apply' sets ctime+mtime, 'throw' rejects, 'mirror' sets both to mtime. */
  ctimeAppend: 'apply' | 'throw' | 'mirror';
  /** append with mtime only: 'apply' sets mtime, 'ignore' leaves it. */
  mtimeAppend: 'apply' | 'ignore';
  /** ctime after creation (before any append). */
  createdCtime: number;
  statNull?: boolean;
  statCtimeOverride?: number;
  writeThrows?: boolean;
  removeThrows?: boolean;
}

function fake(b: Behavior): { adapter: Pick<DataAdapter, 'write' | 'append' | 'stat' | 'remove' | 'exists'>; remove: jest.Mock; present: () => boolean } {
  let present = false;
  let ctime = b.createdCtime;
  let mtime = NOW;
  const remove = jest.fn(async () => {
    if (b.removeThrows) throw new Error('remove failed');
    present = false;
  });
  const adapter = {
    write: jest.fn(async () => {
      if (b.writeThrows) throw new Error('write failed');
      present = true;
      ctime = b.createdCtime;
      mtime = NOW;
    }),
    append: jest.fn(async (_p: string, _d: string, o?: { ctime?: number; mtime?: number }) => {
      if (o?.ctime !== undefined) {
        if (b.ctimeAppend === 'throw') throw new Error('ctime unsupported');
        if (b.ctimeAppend === 'mirror') { mtime = o.mtime ?? mtime; ctime = mtime; return; }
        ctime = o.ctime;
        mtime = o.mtime ?? mtime;
        return;
      }
      if (b.mtimeAppend === 'apply' && o?.mtime !== undefined) mtime = o.mtime;
    }),
    stat: jest.fn(async () => {
      if (b.statNull || !present) return null;
      return { type: 'file' as const, size: 0, ctime: b.statCtimeOverride ?? ctime, mtime };
    }),
    remove,
    exists: jest.fn(async () => present),
  } as unknown as Pick<DataAdapter, 'write' | 'append' | 'stat' | 'remove' | 'exists'>;
  return { adapter, remove, present: () => present };
}

const base: Behavior = { ctimeAppend: 'apply', mtimeAppend: 'apply', createdCtime: NOW };

describe(`${spec('CT-10')} probeCreationTimeSupport`, () => {
  const run = async (b: Behavior) => {
    const f = fake(b);
    const result = await probeCreationTimeSupport(f.adapter, PROBE_PATH, () => NOW);
    return { result, f };
  };

  const cases: Array<[string, Behavior, string]> = [
    ['append reflects both ctime and mtime -> settable', { ...base }, 'settable'],
    ['ctime append throws, mtime-only append works, ctime stays at creation time -> readOnly',
      { ...base, ctimeAppend: 'throw' }, 'readOnly'],
    ['append mirrors mtime into ctime -> untrusted', { ...base, ctimeAppend: 'mirror' }, 'untrusted'],
    ['mtime cannot be set -> untrusted', { ...base, ctimeAppend: 'throw', mtimeAppend: 'ignore' }, 'untrusted'],
    ['stat returns null -> untrusted', { ...base, statNull: true }, 'untrusted'],
    ['stat ctime is 0 -> untrusted', { ...base, ctimeAppend: 'throw', statCtimeOverride: 0 }, 'untrusted'],
    ['ctime far from creation time -> untrusted',
      { ...base, ctimeAppend: 'throw', createdCtime: NOW - 120_000 }, 'untrusted'],
    ['write throws -> untrusted', { ...base, writeThrows: true }, 'untrusted'],
  ];

  it.each(cases)('%s', async (_name, b, expected) => {
    const { result, f } = await run(b);
    expect(result).toBe(expected);
    expect(CREATION_TIME_SUPPORT).toContain(result);
    expect(f.present()).toBe(false);
  });

  it('removes the probe file after a successful probe', async () => {
    const { f } = await run(base);
    expect(f.remove).toHaveBeenCalledWith(PROBE_PATH);
  });

  it('ignores a failing remove and keeps the classification', async () => {
    const { result } = await run({ ...base, removeThrows: true });
    expect(result).toBe('settable');
  });

  it('does not reject when remove fails after an earlier failure', async () => {
    const { result } = await run({ ...base, statNull: true, removeThrows: true });
    expect(result).toBe('untrusted');
  });

  it('exposes distinct probe timestamps', () => {
    expect(PROBE_CTIME_MS).not.toBe(PROBE_MTIME_MS);
  });
});
