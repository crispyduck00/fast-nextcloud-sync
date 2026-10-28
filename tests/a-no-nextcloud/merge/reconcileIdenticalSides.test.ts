import { MergeEngine } from '../../../src/sync/merge/MergeEngine';
import { ReconcileTextStrategy } from '../../../src/sync/merge/ReconcileTextStrategy';
import { MergeContext } from '../../../src/types';

// A three-way merge whose two sides are identical must return exactly that text, whatever the base is.
// Uses the REAL reconcile-text (no mock).
const sides: ReadonlyArray<string> = [
  'hello',
  'a\nb\nc\n',
  'a\nb',
  'a\r\nb\r\n',
  '\u65e5\u672c\u8a9e\u306e\u884c\n\u4e8c\u884c\u76ee\n',
  'x\nx\nx\n',
  '# t\n\nbody\n\nbody\n',
];

type BaseKind = 'empty' | 'same' | 'different';
const baseKinds: ReadonlyArray<BaseKind> = ['empty', 'same', 'different'];

function baseFor(kind: BaseKind, side: string): string {
  if (kind === 'empty') return '';
  if (kind === 'same') return side;
  return 'unrelated base\n';
}

const cases: Array<[BaseKind, string]> = [];
for (const kind of baseKinds) {
  for (const side of sides) cases.push([kind, side]);
}

describe('[SPEC:DEP-4] identical sides', () => {
  const markers: MergeContext = { localMtime: 0, remoteMtime: 0, conflictStrategy: 'conflict-markers' };

  it('enumerates all 21 base x side combinations', () => {
    expect(cases).toHaveLength(21);
  });

  it.each(cases)('ReconcileTextStrategy returns the side unchanged (base: %s, side: %j)', (kind, side) => {
    const base = baseFor(kind, side);
    const result = new ReconcileTextStrategy().merge(base, side, side);
    expect(result.success).toBe(true);
    expect(result.mergedContent).toBe(side);
  });

  it.each(cases)('MergeEngine returns the side unchanged without conflicts (base: %s, side: %j)', (kind, side) => {
    const base = baseFor(kind, side);
    const result = new MergeEngine().merge(base, side, side, markers);
    expect(result.hadConflicts).toBe(false);
    expect(result.mergedContent).toBe(side);
  });
});
