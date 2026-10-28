// atomicWrite/atomicWriteBinary must not delete the tmp file when `rename` fails AFTER the pre-existing target was
// removed: tmpPath is then the ONLY surviving copy (mobile kill / Windows AV lock / storage blip mid-rename), so
// deleting it in the catch block would lose the data outright.
import { LocalAdapter } from '../../../src/data/LocalAdapter';
import { DataAdapter } from 'obsidian';

// Fake adapter where `remove(target)` succeeds but the subsequent `rename` always throws: the crash window under test.
function makeCrashingAdapter(target: string) {
  const files = new Map<string, string | ArrayBuffer>();
  const adapter = {
    mkdir: jest.fn(async () => undefined),
    write: jest.fn(async (p: string, d: string) => { files.set(p, d); }),
    writeBinary: jest.fn(async (p: string, d: ArrayBuffer) => { files.set(p, d); }),
    exists: jest.fn(async (p: string) => files.has(p)),
    remove: jest.fn(async (p: string) => { files.delete(p); }),
    rename: jest.fn(async () => { throw new Error('simulated crash: rename never completed'); }),
    stat: jest.fn(async (p: string) => {
      const v = files.get(p);
      return v instanceof ArrayBuffer ? { size: v.byteLength, mtime: 0 } : null;
    }),
  } as unknown as DataAdapter;
  return { adapter, files };
}

describe('[SPEC:G4-1] atomicWrite/atomicWriteBinary must not delete the sole surviving tmp copy on a post-remove rename failure', () => {
  it('atomicWrite: rename fails after remove(target) — tmp is kept (not deleted) and the error still propagates', async () => {
    const target = 'Notes/hello.md';
    const { adapter, files } = makeCrashingAdapter(target);
    files.set(target, 'old content'); // pre-existing target so remove(target) actually runs
    const local = new LocalAdapter(adapter);

    await expect(local.atomicWrite(target, 'new content')).rejects.toThrow('simulated crash');

    // The old target is gone (remove() ran) — losing tmp too would mean total data loss.
    expect(await adapter.exists(target)).toBe(false);
    // Exactly one file remains: the tmp file holding the new content. It must NOT have been deleted.
    const remainingPaths = [...files.keys()];
    expect(remainingPaths).toHaveLength(1);
    expect(remainingPaths[0]).toMatch(/\.ncs\.tmp$/);
    expect(files.get(remainingPaths[0])).toBe('new content');
  });

  it('atomicWriteBinary: rename fails after remove(target) — tmp is kept (not deleted) and the error still propagates', async () => {
    const target = 'attachments/img.png';
    const { adapter, files } = makeCrashingAdapter(target);
    files.set(target, new ArrayBuffer(2)); // pre-existing target so remove(target) actually runs
    const local = new LocalAdapter(adapter);
    const newData = new ArrayBuffer(4);

    await expect(local.atomicWriteBinary(target, newData)).rejects.toThrow('simulated crash');

    expect(await adapter.exists(target)).toBe(false);
    const remainingPaths = [...files.keys()];
    expect(remainingPaths).toHaveLength(1);
    expect(remainingPaths[0]).toMatch(/\.ncs\.tmp$/);
    expect((files.get(remainingPaths[0]) as ArrayBuffer).byteLength).toBe(4);
  });

  it('still cleans up tmp on a failure BEFORE the target is removed (write failure), preserving the old target untouched', async () => {
    const target = 'Notes/fail.md';
    const files = new Map<string, string>();
    const adapter = {
      mkdir: jest.fn(async () => undefined),
      write: jest.fn(async () => { throw new Error('disk full'); }),
      exists: jest.fn(async (p: string) => files.has(p)),
      remove: jest.fn(async (p: string) => { files.delete(p); }),
      rename: jest.fn(async () => undefined),
    } as unknown as DataAdapter;
    files.set(target, 'old content');
    const local = new LocalAdapter(adapter);

    await expect(local.atomicWrite(target, 'new content')).rejects.toThrow('disk full');

    // The write to tmp itself failed, so remove(target) never ran: old content survives untouched,
    // and there is no leftover tmp file to clean up either way.
    expect(files.get(target)).toBe('old content');
  });
});

// Plain in-memory adapter whose rename succeeds, used to inspect the write options that reach the adapter.
function makeWorkingAdapter() {
  const files = new Map<string, string | ArrayBuffer>();
  const adapter = {
    mkdir: jest.fn(async () => undefined),
    write: jest.fn(async (p: string, d: string) => { files.set(p, d); }),
    writeBinary: jest.fn(async (p: string, d: ArrayBuffer) => { files.set(p, d); }),
    exists: jest.fn(async (p: string) => files.has(p)),
    remove: jest.fn(async (p: string) => { files.delete(p); }),
    rename: jest.fn(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    stat: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) return null;
      return { size: typeof v === 'string' ? v.length : v.byteLength, mtime: 0 };
    }),
  } as unknown as DataAdapter;
  return { adapter, files };
}

type WriteOpts = { mtime?: number } | undefined;

describe('[SPEC:MT-1] atomicWrite/atomicWriteBinary pass the requested mtime to the adapter write', () => {
  const T = Date.UTC(2020, 0, 1);

  it('atomicWriteBinary(p, data, T) passes { mtime: T } as the third argument of adapter.writeBinary', async () => {
    const { adapter } = makeWorkingAdapter();
    const local = new LocalAdapter(adapter);

    await local.atomicWriteBinary('attachments/img.png', new ArrayBuffer(4), T);

    const opts = (adapter.writeBinary as jest.Mock).mock.calls[0][2] as WriteOpts;
    expect(opts?.mtime).toBe(T);
  });

  it('atomicWrite(p, text, T) passes { mtime: T } as the third argument of adapter.write', async () => {
    const { adapter } = makeWorkingAdapter();
    const local = new LocalAdapter(adapter);

    await local.atomicWrite('Notes/hello.md', 'body', T);

    const opts = (adapter.write as jest.Mock).mock.calls[0][2] as WriteOpts;
    expect(opts?.mtime).toBe(T);
  });

  it.each([
    ['omitted', undefined],
    ['zero', 0],
  ])('atomicWriteBinary with mtime %s passes no mtime to adapter.writeBinary', async (_label, mtime) => {
    const { adapter } = makeWorkingAdapter();
    const local = new LocalAdapter(adapter);

    if (mtime === undefined) await local.atomicWriteBinary('attachments/img.png', new ArrayBuffer(4));
    else await local.atomicWriteBinary('attachments/img.png', new ArrayBuffer(4), mtime);

    const opts = (adapter.writeBinary as jest.Mock).mock.calls[0][2] as WriteOpts;
    expect(opts?.mtime).toBeUndefined();
  });

  it.each([
    ['omitted', undefined],
    ['zero', 0],
  ])('atomicWrite with mtime %s passes no mtime to adapter.write', async (_label, mtime) => {
    const { adapter } = makeWorkingAdapter();
    const local = new LocalAdapter(adapter);

    if (mtime === undefined) await local.atomicWrite('Notes/hello.md', 'body');
    else await local.atomicWrite('Notes/hello.md', 'body', mtime);

    const opts = (adapter.write as jest.Mock).mock.calls[0][2] as WriteOpts;
    expect(opts?.mtime).toBeUndefined();
  });

  it('the mtime goes to the tmp file write, before the remove -> rename swap', async () => {
    const { adapter, files } = makeWorkingAdapter();
    files.set('Notes/hello.md', 'old');
    const local = new LocalAdapter(adapter);

    await local.atomicWrite('Notes/hello.md', 'new', T);

    const writtenPath = (adapter.write as jest.Mock).mock.calls[0][0] as string;
    expect(writtenPath).toMatch(/\.ncs\.tmp$/);
    expect(files.get('Notes/hello.md')).toBe('new');
  });
});
