// Creation-time handling in LocalAdapter (docs/spec.md §9.7): trusted stat, ctime in write options only for a
// 'settable' platform, the Windows tunneling correction, and setCreationTime.
import { LocalAdapter } from '../../../src/data/LocalAdapter';
import type { CreationTimeSupport } from '../../../src/data/creationTimeProbe';
import { DataAdapter, FileView, TFile, Vault, Workspace } from 'obsidian';

const CTIME = 1_700_000_000_000;
const MTIME = 1_700_000_500_000;

interface Fake {
  adapter: DataAdapter;
  files: Map<string, string | ArrayBuffer>;
  /** ctime reported by stat for every existing path; undefined omits the property. */
  state: { ctime: number | undefined; mtime: number; folder: boolean };
}

function makeFake(): Fake {
  const files = new Map<string, string | ArrayBuffer>();
  const state = { ctime: CTIME as number | undefined, mtime: MTIME, folder: false };
  const adapter = {
    mkdir: jest.fn(async () => undefined),
    write: jest.fn(async (p: string, d: string) => { files.set(p, d); }),
    writeBinary: jest.fn(async (p: string, d: ArrayBuffer) => { files.set(p, d); }),
    append: jest.fn(async () => undefined),
    exists: jest.fn(async (p: string) => files.has(p)),
    remove: jest.fn(async (p: string) => { files.delete(p); }),
    rename: jest.fn(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    stat: jest.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) return state.folder ? { type: 'folder', size: 0, mtime: state.mtime, ctime: state.ctime } : null;
      const size = typeof v === 'string' ? v.length : v.byteLength;
      const st: Record<string, unknown> = { type: 'file', size, mtime: state.mtime };
      if (state.ctime !== undefined) st.ctime = state.ctime;
      return st;
    }),
  } as unknown as DataAdapter;
  return { adapter, files, state };
}

const src = (s: CreationTimeSupport) => async () => s;

function optionsOf(fn: unknown, callIndex = 0): unknown {
  return (fn as jest.Mock).mock.calls[callIndex][2];
}

describe('[SPEC:CT-10] LocalAdapter.stat exposes ctime only when trusted and valid', () => {
  it.each<CreationTimeSupport>(['settable', 'readOnly'])('returns a valid ctime for %s', async (support) => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'x');
    const st = await new LocalAdapter(adapter, undefined, undefined, src(support)).stat('a.md');
    expect(st).toEqual({ size: 1, mtime: MTIME, ctime: CTIME });
  });

  it('omits the ctime property for untrusted', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'x');
    const st = await new LocalAdapter(adapter, undefined, undefined, src('untrusted')).stat('a.md');
    expect(st).toEqual({ size: 1, mtime: MTIME });
    expect(st).not.toHaveProperty('ctime');
  });

  it('omits the ctime property when no source is given', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'x');
    const st = await new LocalAdapter(adapter).stat('a.md');
    expect(st).not.toHaveProperty('ctime');
  });

  it('omits the ctime property when the source rejects', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'x');
    const local = new LocalAdapter(adapter, undefined, undefined, async () => { throw new Error('probe failed'); });
    const st = await local.stat('a.md');
    expect(st).not.toHaveProperty('ctime');
    await expect(local.creationTimeSupport()).resolves.toBe('untrusted');
  });

  it.each([0, 86_400_000, undefined])('omits the ctime property for an invalid ctime (%s) even when settable', async (bad) => {
    const { adapter, files, state } = makeFake();
    files.set('a.md', 'x');
    state.ctime = bad;
    const st = await new LocalAdapter(adapter, undefined, undefined, src('settable')).stat('a.md');
    expect(st).toEqual({ size: 1, mtime: MTIME });
    expect(st).not.toHaveProperty('ctime');
  });

  it('returns null for a missing path and a non-null stat for a folder', async () => {
    const { adapter, state } = makeFake();
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    expect(await local.stat('missing.md')).toBeNull();
    state.folder = true;
    expect(await local.stat('Folder')).not.toBeNull();
  });

  it('calls the source exactly once across stat and atomicWrite calls (memoized)', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'x');
    const source = jest.fn(async (): Promise<CreationTimeSupport> => 'settable');
    const local = new LocalAdapter(adapter, undefined, undefined, source);
    await local.stat('a.md');
    await local.stat('a.md');
    await local.atomicWrite('a.md', 'y', MTIME, CTIME);
    await local.atomicWriteBinary('b.bin', new ArrayBuffer(2), MTIME, CTIME);
    await local.creationTimeSupport();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('memoizes a rejected source as untrusted without calling it again', async () => {
    const { adapter } = makeFake();
    const source = jest.fn(async (): Promise<CreationTimeSupport> => { throw new Error('boom'); });
    const local = new LocalAdapter(adapter, undefined, undefined, source);
    await local.creationTimeSupport();
    await local.creationTimeSupport();
    expect(source).toHaveBeenCalledTimes(1);
  });
});

describe('[SPEC:CT-2] atomicWrite* pass ctime only on a settable platform', () => {
  it('text: settable puts ctime and mtime in the tmp write options', async () => {
    const { adapter } = makeFake();
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWrite('a.md', 'x', MTIME, CTIME);
    expect(optionsOf(adapter.write)).toEqual({ mtime: MTIME, ctime: CTIME });
  });

  it('binary: settable puts ctime and mtime in the tmp writeBinary options', async () => {
    const { adapter } = makeFake();
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWriteBinary('a.bin', new ArrayBuffer(3), MTIME, CTIME);
    expect(optionsOf(adapter.writeBinary)).toEqual({ mtime: MTIME, ctime: CTIME });
  });

  it('settable with ctime only (no mtime) passes just ctime', async () => {
    const { adapter } = makeFake();
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWrite('a.md', 'x', undefined, CTIME);
    expect(optionsOf(adapter.write)).toEqual({ ctime: CTIME });
  });

  it.each<CreationTimeSupport>(['readOnly', 'untrusted'])('%s never passes ctime', async (support) => {
    const { adapter } = makeFake();
    const local = new LocalAdapter(adapter, undefined, undefined, src(support));
    await local.atomicWrite('a.md', 'x', MTIME, CTIME);
    await local.atomicWriteBinary('a.bin', new ArrayBuffer(3), MTIME, CTIME);
    expect(optionsOf(adapter.write)).toEqual({ mtime: MTIME });
    expect(optionsOf(adapter.writeBinary)).toEqual({ mtime: MTIME });
  });

  it('without a source ctime is never passed', async () => {
    const { adapter } = makeFake();
    await new LocalAdapter(adapter).atomicWrite('a.md', 'x', MTIME, CTIME);
    expect(optionsOf(adapter.write)).toEqual({ mtime: MTIME });
  });

  it('keeps the existing mtime behaviour: mtime > 0 passes mtime; neither omits the argument', async () => {
    const { adapter } = makeFake();
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await local.atomicWrite('a.md', 'x', MTIME);
    expect(optionsOf(adapter.write, 0)).toEqual({ mtime: MTIME });
    await local.atomicWrite('b.md', 'x');
    expect((adapter.write as jest.Mock).mock.calls[1]).toHaveLength(2);
    await local.atomicWrite('c.md', 'x', 0);
    expect((adapter.write as jest.Mock).mock.calls[2]).toHaveLength(2);
  });

  it('does not pass an invalid ctime (86400000)', async () => {
    const { adapter } = makeFake();
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await local.atomicWrite('a.md', 'x', MTIME, 86_400_000);
    await local.atomicWriteBinary('a.bin', new ArrayBuffer(3), undefined, 86_400_000);
    expect(optionsOf(adapter.write)).toEqual({ mtime: MTIME });
    expect((adapter.writeBinary as jest.Mock).mock.calls[0]).toHaveLength(2);
    expect(adapter.append).not.toHaveBeenCalled();
  });

  describe('open-file path (vault.modify / modifyBinary)', () => {
    function openSetup(support: CreationTimeSupport) {
      const fake = makeFake();
      const file = { path: 'open.md' } as unknown as TFile;
      fake.files.set('open.md', 'old');
      const view = Object.create(FileView.prototype) as FileView;
      view.file = file;
      const workspace = {
        iterateAllLeaves: (cb: (leaf: { view: FileView }) => void) => [{ view }].forEach(cb),
      } as unknown as Workspace;
      const modify = jest.fn(async () => undefined);
      const modifyBinary = jest.fn(async () => undefined);
      const vault = { getFileByPath: () => file, getFiles: () => [file], modify, modifyBinary } as unknown as Vault;
      return { ...fake, modify, modifyBinary, local: new LocalAdapter(fake.adapter, vault, workspace, src(support)) };
    }

    it('settable passes ctime to modify and modifyBinary', async () => {
      const { local, modify, modifyBinary } = openSetup('settable');
      await local.atomicWrite('open.md', 'x', MTIME, CTIME);
      await local.atomicWriteBinary('open.md', new ArrayBuffer(1), MTIME, CTIME);
      expect(optionsOf(modify)).toEqual({ mtime: MTIME, ctime: CTIME });
      expect(optionsOf(modifyBinary)).toEqual({ mtime: MTIME, ctime: CTIME });
    });

    it('readOnly does not pass ctime', async () => {
      const { local, modify, modifyBinary } = openSetup('readOnly');
      await local.atomicWrite('open.md', 'x', MTIME, CTIME);
      await local.atomicWriteBinary('open.md', new ArrayBuffer(1), MTIME, CTIME);
      expect(optionsOf(modify)).toEqual({ mtime: MTIME });
      expect(optionsOf(modifyBinary)).toEqual({ mtime: MTIME });
    });
  });
});

describe('[SPEC:CT-2] tunneling correction after a settable write', () => {
  it('appends once with { ctime, mtime } when the stored ctime differs by 1000 ms or more', async () => {
    const { adapter, state } = makeFake();
    state.ctime = CTIME + 5000;
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWrite('a.md', 'x', MTIME, CTIME);
    expect(adapter.append).toHaveBeenCalledTimes(1);
    expect(adapter.append).toHaveBeenCalledWith('a.md', '', { ctime: CTIME, mtime: MTIME });
  });

  it('also corrects after a binary write', async () => {
    const { adapter, state } = makeFake();
    state.ctime = CTIME + 5000;
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWriteBinary('a.bin', new ArrayBuffer(2), MTIME, CTIME);
    expect(adapter.append).toHaveBeenCalledTimes(1);
  });

  it('does not append when the stored ctime matches (within 1000 ms)', async () => {
    const { adapter, state } = makeFake();
    state.ctime = CTIME + 999;
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await local.atomicWrite('a.md', 'x', MTIME, CTIME);
    await local.atomicWriteBinary('a.bin', new ArrayBuffer(2), MTIME, CTIME);
    expect(adapter.append).not.toHaveBeenCalled();
  });

  it('does not append when no ctime was passed', async () => {
    const { adapter, state } = makeFake();
    state.ctime = CTIME + 5000;
    await new LocalAdapter(adapter, undefined, undefined, src('settable')).atomicWrite('a.md', 'x', MTIME);
    expect(adapter.append).not.toHaveBeenCalled();
  });

  it('resolves even when the correcting append throws', async () => {
    const { adapter, state } = makeFake();
    state.ctime = CTIME + 5000;
    (adapter.append as jest.Mock).mockRejectedValue(new Error('append failed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await expect(local.atomicWrite('a.md', 'x', MTIME, CTIME)).resolves.toBeUndefined();
    await expect(local.atomicWriteBinary('a.bin', new ArrayBuffer(2), MTIME, CTIME)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('[SPEC:CT-9] LocalAdapter.setCreationTime', () => {
  it('appends an empty string with { ctime, mtime: current mtime } and reports applied when the re-stat matches', async () => {
    const { adapter, files, state } = makeFake();
    files.set('Notes/a.md', 'body');
    state.ctime = CTIME - 10_000;
    (adapter.append as jest.Mock).mockImplementation(async () => { state.ctime = CTIME + 500; });
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await expect(local.setCreationTime('Notes/a.md', CTIME)).resolves.toBe('applied');
    expect(adapter.append).toHaveBeenCalledTimes(1);
    expect(adapter.append).toHaveBeenCalledWith('Notes/a.md', '', { ctime: CTIME, mtime: MTIME });
    expect(files.get('Notes/a.md')).toBe('body');
  });

  it('normalizes the path passed to the adapter', async () => {
    const { adapter, files } = makeFake();
    files.set('Notes/a.md', 'body');
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await local.setCreationTime('Notes//a.md', CTIME);
    expect((adapter.append as jest.Mock).mock.calls[0][0]).toBe('Notes/a.md');
  });

  it('reports ineffective when the re-stat ctime is 1000 ms or more away', async () => {
    const { adapter, files, state } = makeFake();
    files.set('a.md', 'body');
    state.ctime = CTIME + 5000; // append has no effect
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await expect(local.setCreationTime('a.md', CTIME)).resolves.toBe('ineffective');
  });

  it('reports absent without appending when the file does not exist', async () => {
    const { adapter } = makeFake();
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await expect(local.setCreationTime('gone.md', CTIME)).resolves.toBe('absent');
    expect(adapter.append).not.toHaveBeenCalled();
  });

  it('rejects when append throws', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'body');
    (adapter.append as jest.Mock).mockRejectedValue(new Error('io error'));
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    await expect(local.setCreationTime('a.md', CTIME)).rejects.toThrow('io error');
  });

  it('registers the path in the ignore list', async () => {
    const { adapter, files } = makeFake();
    files.set('a.md', 'body');
    const local = new LocalAdapter(adapter, undefined, undefined, src('settable'));
    expect(local.shouldIgnore('a.md')).toBe(false);
    await local.setCreationTime('a.md', CTIME);
    expect(local.shouldIgnore('a.md')).toBe(true);
    local.dispose();
  });
});
