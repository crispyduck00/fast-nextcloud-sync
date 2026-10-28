// [SPEC:CT-1] [SPEC:CT-2] [SPEC:CT-4] [SPEC:CT-6] [SPEC:CT-7] [SPEC:CT-8] Pure creation-time rules (docs/spec.md §9.7).
//
// Every combination of local value, server value, device class and attempt record is enumerated, because the
// plan decides which side is written and a wrong cell either rewrites files forever or never converges.
import {
  MIN_VALID_CREATION_SECONDS,
  alignedCreationSeconds,
  creationSeconds,
  isValidCreationMs,
  planCreationTimeAlignment,
  uploadCreationTimeMs,
  writeCreationTimeMs,
  type CreationTimeAlignmentPlan,
} from '../../../src/util/creationTime';

const OLD_S = 1_700_000_100;
const MID_S = 1_700_000_150;
const NEW_S = 1_700_000_200;
const DAY_MS = 86400 * 1000;

describe('[SPEC:CT-1] validity and whole-second comparison', () => {
  it('keeps the Nextcloud lower bound at one day', () => {
    expect(MIN_VALID_CREATION_SECONDS).toBe(86400);
  });

  it.each<[string, number | undefined | null, boolean]>([
    ['undefined', undefined, false],
    ['null', null, false],
    ['NaN', NaN, false],
    ['Infinity', Infinity, false],
    ['-Infinity', -Infinity, false],
    ['zero', 0, false],
    ['negative', -5000, false],
    ['exactly one day', DAY_MS, false],
    ['one day plus 999 ms (floors to one day)', DAY_MS + 999, false],
    ['one day plus one second', 86401 * 1000, true],
    ['a value with a millisecond fraction', NEW_S * 1000 + 123, true],
    ['a fractional millisecond value', NEW_S * 1000 + 0.5, true],
    ['one year in the future', Date.now() + 365 * DAY_MS, true],
  ])('isValidCreationMs: %s', (_name, value, expected) => {
    expect(isValidCreationMs(value)).toBe(expected);
  });

  it('creationSeconds floors milliseconds to seconds', () => {
    expect(creationSeconds(NEW_S * 1000)).toBe(NEW_S);
    expect(creationSeconds(NEW_S * 1000 + 999)).toBe(NEW_S);
    expect(creationSeconds(NEW_S * 1000 - 1)).toBe(NEW_S - 1);
  });

  it('alignedCreationSeconds returns the smallest valid value in seconds', () => {
    expect(alignedCreationSeconds(NEW_S * 1000, OLD_S * 1000)).toBe(OLD_S);
    expect(alignedCreationSeconds(OLD_S * 1000, NEW_S * 1000)).toBe(OLD_S);
    expect(alignedCreationSeconds(NEW_S * 1000, OLD_S * 1000, MID_S * 1000)).toBe(OLD_S);
    expect(alignedCreationSeconds(OLD_S * 1000 + 900, OLD_S * 1000 + 100)).toBe(OLD_S);
  });

  it('alignedCreationSeconds ignores invalid values', () => {
    expect(alignedCreationSeconds(undefined, NEW_S * 1000)).toBe(NEW_S);
    expect(alignedCreationSeconds(0, NEW_S * 1000, null)).toBe(NEW_S);
    expect(alignedCreationSeconds(DAY_MS, NaN, OLD_S * 1000)).toBe(OLD_S);
  });

  it('alignedCreationSeconds returns null when nothing is valid', () => {
    expect(alignedCreationSeconds()).toBeNull();
    expect(alignedCreationSeconds(undefined, null, 0, NaN, DAY_MS)).toBeNull();
  });
});

type Cell = { name: string; ms: number | undefined };

const LOCALS: Cell[] = [
  { name: 'undefined', ms: undefined },
  { name: 'invalid', ms: 0 },
  { name: 'old', ms: OLD_S * 1000 },
  { name: 'new', ms: NEW_S * 1000 },
];
const REMOTES: Cell[] = [
  { name: 'undefined', ms: undefined },
  { name: 'zero', ms: 0 },
  { name: 'invalid', ms: DAY_MS },
  { name: 'old', ms: OLD_S * 1000 },
  { name: 'new', ms: NEW_S * 1000 },
];

describe('[SPEC:CT-2][SPEC:CT-4] write and upload values over every local x server cell', () => {
  const cells = LOCALS.flatMap((l) => REMOTES.map((r) => ({ l, r })));

  it('covers all 20 cells', () => {
    expect(cells).toHaveLength(20);
  });

  it.each(cells.map((c) => [c.l.name, c.r.name, c.l.ms, c.r.ms] as const))(
    'local %s, server %s',
    (_ln, _rn, localMs, remoteMs) => {
      const aligned = alignedCreationSeconds(localMs, remoteMs);
      const expectedWrite = aligned === null ? undefined : aligned * 1000;
      const write = writeCreationTimeMs(localMs, remoteMs);
      expect(write).toBe(expectedWrite);
      if (write !== undefined) expect(write % 1000).toBe(0);

      const upload = uploadCreationTimeMs(localMs, remoteMs);
      expect(upload).toBe(remoteMs === undefined ? undefined : expectedWrite);
      if (upload !== undefined) expect(upload % 1000).toBe(0);
    },
  );

  it('writes the older of two valid values', () => {
    expect(writeCreationTimeMs(NEW_S * 1000 + 700, OLD_S * 1000 + 300)).toBe(OLD_S * 1000);
    expect(writeCreationTimeMs(OLD_S * 1000, NEW_S * 1000)).toBe(OLD_S * 1000);
  });

  it('writes the valid side when the other is invalid', () => {
    expect(writeCreationTimeMs(undefined, NEW_S * 1000)).toBe(NEW_S * 1000);
    expect(writeCreationTimeMs(NEW_S * 1000, 0)).toBe(NEW_S * 1000);
  });

  it('writes nothing when neither side is valid (the write time applies)', () => {
    expect(writeCreationTimeMs(undefined, undefined)).toBeUndefined();
    expect(writeCreationTimeMs(0, 0)).toBeUndefined();
  });

  it('sends no upload value when the server value is unknown, even if local is valid', () => {
    expect(uploadCreationTimeMs(OLD_S * 1000, undefined)).toBeUndefined();
  });

  it('sends the local value for a file the server is known not to have (creationTime 0)', () => {
    expect(uploadCreationTimeMs(NEW_S * 1000 + 450, 0)).toBe(NEW_S * 1000);
  });
});

type Klass = 'settable' | 'readOnly' | 'untrusted';
type RecordKind = 'none' | 'same' | 'different';

const KLASSES: Klass[] = ['settable', 'readOnly', 'untrusted'];
const RECORDS: RecordKind[] = ['none', 'same', 'different'];

/** Independent reference for rules 1-4, written separately from the implementation. */
function reference(
  localMs: number | undefined,
  remoteMs: number | undefined,
  settable: boolean,
  localAttempt: number | undefined,
  remoteAttempt: number | undefined,
): CreationTimeAlignmentPlan {
  const none = { setLocalSeconds: null, setRemoteSeconds: null };
  if (remoteMs === undefined) return none;
  const ok = (v: number | undefined): v is number =>
    v !== undefined && Number.isFinite(v) && Math.floor(v / 1000) > 86400;
  const l = ok(localMs) ? Math.floor(localMs / 1000) : undefined;
  const r = ok(remoteMs) ? Math.floor(remoteMs / 1000) : undefined;
  const cands = [l, r].filter((v): v is number => v !== undefined);
  if (cands.length === 0) return none;
  const t = Math.min(...cands);
  return {
    setLocalSeconds: settable && l !== t && localAttempt !== t ? t : null,
    setRemoteSeconds: r !== t && remoteAttempt !== t ? t : null,
  };
}

function attemptFor(kind: RecordKind, localMs: number | undefined, remoteMs: number | undefined) {
  const t = alignedCreationSeconds(localMs, remoteMs);
  const base = t ?? OLD_S;
  if (kind === 'none') return undefined;
  return kind === 'same' ? base : base - 1;
}

describe('[SPEC:CT-6][SPEC:CT-7][SPEC:CT-8] planCreationTimeAlignment over every combination', () => {
  const rows = KLASSES.flatMap((klass) =>
    LOCALS.flatMap((l) =>
      REMOTES.flatMap((r) =>
        RECORDS.map((record) => ({
          klass,
          // An untrusted device never reports a local value.
          localMs: klass === 'untrusted' ? undefined : l.ms,
          localName: klass === 'untrusted' ? 'undefined' : l.name,
          remoteMs: r.ms,
          remoteName: r.name,
          record,
        })),
      ),
    ),
  );

  it('generates 180 combinations', () => {
    expect(rows).toHaveLength(180);
  });

  it.each(rows.map((x) => [x.klass, x.localName, x.remoteName, x.record, x] as const))(
    '%s, local %s, server %s, record %s',
    (_k, _ln, _rn, _rec, row) => {
      const attempt = attemptFor(row.record, row.localMs, row.remoteMs);
      const input = {
        localCtimeMs: row.localMs,
        remoteCreationTimeMs: row.remoteMs,
        localSettable: row.klass === 'settable',
        localAttemptSeconds: attempt,
        remoteAttemptSeconds: attempt,
      };
      const plan = planCreationTimeAlignment(input);
      expect(plan).toEqual(
        reference(row.localMs, row.remoteMs, input.localSettable, attempt, attempt),
      );
      // Only the newer side is ever changed, so at most one side is written.
      expect(plan.setLocalSeconds !== null && plan.setRemoteSeconds !== null).toBe(false);
    },
  );

  it('never writes anything when the server value is unknown', () => {
    for (const l of LOCALS) {
      for (const record of RECORDS) {
        const attempt = attemptFor(record, l.ms, undefined);
        expect(
          planCreationTimeAlignment({
            localCtimeMs: l.ms,
            remoteCreationTimeMs: undefined,
            localSettable: true,
            localAttemptSeconds: attempt,
            remoteAttemptSeconds: attempt,
          }),
        ).toEqual({ setLocalSeconds: null, setRemoteSeconds: null });
      }
    }
  });
});

describe('[SPEC:CT-6][SPEC:CT-7][SPEC:CT-8] planCreationTimeAlignment representative rows (fixed values)', () => {
  const ms = (s: number | undefined) => (s === undefined ? undefined : s * 1000);
  const P = OLD_S; // plays "100"
  const Q = NEW_S; // plays "200"
  const M = MID_S; // plays "150"

  type Row = {
    name: string;
    klass: Klass;
    l: number | undefined;
    r: number | undefined;
    localAttempt?: number;
    remoteAttempt?: number;
    setLocal: number | null;
    setRemote: number | null;
  };

  const table: Row[] = [
    { name: 'unknown server value, settable', klass: 'settable', l: Q, r: undefined, setLocal: null, setRemote: null },
    { name: 'unknown server value, readOnly', klass: 'readOnly', l: P, r: undefined, setLocal: null, setRemote: null },
    { name: 'invalid local and server zero', klass: 'settable', l: 0, r: 0, setLocal: null, setRemote: null },
    { name: 'local older: set server', klass: 'settable', l: P, r: Q, setLocal: null, setRemote: P },
    { name: 'server older: set local', klass: 'settable', l: Q, r: P, setLocal: P, setRemote: null },
    { name: 'server older, local already tried', klass: 'settable', l: Q, r: P, localAttempt: P, setLocal: null, setRemote: null },
    { name: 'server older, local tried another value', klass: 'settable', l: Q, r: P, localAttempt: M, setLocal: P, setRemote: null },
    { name: 'readOnly never sets local', klass: 'readOnly', l: Q, r: P, setLocal: null, setRemote: null },
    { name: 'readOnly, server missing value', klass: 'readOnly', l: P, r: 0, setLocal: null, setRemote: P },
    { name: 'readOnly, server already tried', klass: 'readOnly', l: P, r: 0, remoteAttempt: P, setLocal: null, setRemote: null },
    { name: 'untrusted with a server value', klass: 'untrusted', l: undefined, r: P, setLocal: null, setRemote: null },
    { name: 'invalid local, settable: copy server value', klass: 'settable', l: 0, r: P, setLocal: P, setRemote: null },
    { name: 'equal values', klass: 'settable', l: P, r: P, setLocal: null, setRemote: null },
    { name: 'equal values with stale records', klass: 'settable', l: P, r: P, localAttempt: M, remoteAttempt: M, setLocal: null, setRemote: null },
  ];

  it.each(table.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const plan = planCreationTimeAlignment({
      localCtimeMs: ms(row.l),
      remoteCreationTimeMs: ms(row.r),
      localSettable: row.klass === 'settable',
      localAttemptSeconds: row.localAttempt,
      remoteAttemptSeconds: row.remoteAttempt,
    });
    expect(plan).toEqual({ setLocalSeconds: row.setLocal, setRemoteSeconds: row.setRemote });
  });

  it('compares in whole seconds: a sub-second difference is a match', () => {
    expect(
      planCreationTimeAlignment({
        localCtimeMs: OLD_S * 1000 + 900,
        remoteCreationTimeMs: OLD_S * 1000 + 100,
        localSettable: true,
        localAttemptSeconds: undefined,
        remoteAttemptSeconds: undefined,
      }),
    ).toEqual({ setLocalSeconds: null, setRemoteSeconds: null });
  });
});
