// Engine composition (docs/spec.md §9.7): one CreationTimeAligner is shared by transfer, conflicts and resolution.
import { CreationTimeAligner } from '../../../../src/sync/ctime/CreationTimeAligner';
import { buildEngine, makeLocalAdapter } from '../../support/engineHarness';
import { spec } from '../../support/specRef';

interface Wired {
  creationTime: unknown;
  transfer: { deps: { creationTime?: unknown } };
  conflicts: { deps: { creationTime?: unknown } };
  resolution: { deps: { creationTime?: unknown } };
}

describe('SyncEngine creation-time wiring', () => {
  it(`${spec('CT-13')} passes the engine's single CreationTimeAligner to transfer, conflicts and resolution`, async () => {
    const { engine } = await buildEngine(makeLocalAdapter({}) as never, {});
    const wired = engine as unknown as Wired;

    expect(wired.creationTime).toBeInstanceOf(CreationTimeAligner);
    expect(wired.transfer.deps.creationTime).toBe(wired.creationTime);
    expect(wired.conflicts.deps.creationTime).toBe(wired.creationTime);
    expect(wired.resolution.deps.creationTime).toBe(wired.creationTime);
  });
});
