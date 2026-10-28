import {
  decideBundleDirection,
  planBundleFileAction,
  sideChanged,
  fileSameContent,
} from '../../../../src/sync/plugins/bundleDirection';
import type { BundleDirectionInput, BundleFileState, ManifestSide } from '../../../../src/sync/plugins/bundleDirection';
import type { FileState, RemoteFileInfo } from '../../../../src/types';

function remoteInfo(over: Partial<RemoteFileInfo> = {}): RemoteFileInfo {
  return {
    path: '.obsidian/plugins/foo/main.js', fileId: 'fid', checksum: null, etag: 'etag-1',
    size: 10, lastModified: 1_000, ...over,
  };
}

function baseState(over: Partial<FileState> = {}): FileState {
  return {
    path: '.obsidian/plugins/foo/main.js', localHash: 'lh-base', remoteId: 'etag-1', idType: 'etag',
    size: 10, mtime: 100, remoteFileId: 'fid', isConflicted: false, ...over,
  };
}

function side(version: string | null, mtime = 1_000): ManifestSide {
  return { version, mtime };
}

function input(over: Partial<BundleDirectionInput>): BundleDirectionInput {
  return {
    local: side('1.0.0'), remote: side('1.0.0'),
    localChanged: true, remoteChanged: true, sameContent: false, ...over,
  };
}

describe('[SPEC:CPS-5] bundle direction', () => {
  describe('sideChanged', () => {
    it('no tracked id: changed when present, unchanged when absent', () => {
      expect(sideChanged(true, 'x', null)).toBe(true);
      expect(sideChanged(false, null, null)).toBe(false);
    });
    it('tracked id: a missing file is a change', () => {
      expect(sideChanged(false, null, 'b')).toBe(true);
    });
    it('tracked id: present compares the ids', () => {
      expect(sideChanged(true, 'b', 'b')).toBe(false);
      expect(sideChanged(true, 'c', 'b')).toBe(true);
    });
  });

  describe('fileSameContent', () => {
    it('is true when the remote checksum proves the local hash (condition 1 only)', () => {
      expect(fileSameContent({
        localHash: 'h1', remote: remoteInfo({ checksum: 'h1' }), base: null, localChanged: true,
      })).toBe(true);
    });
    it('is true when the local side is unchanged and the remote id equals the base (condition 2 only)', () => {
      expect(fileSameContent({
        localHash: 'h1', remote: remoteInfo({ etag: 'etag-1' }), base: baseState({ remoteId: 'etag-1' }), localChanged: false,
      })).toBe(true);
    });
    it('is false without a local hash', () => {
      expect(fileSameContent({
        localHash: null, remote: remoteInfo({ checksum: 'h1' }), base: baseState(), localChanged: false,
      })).toBe(false);
    });
    it('is false without a remote file', () => {
      expect(fileSameContent({ localHash: 'h1', remote: null, base: baseState(), localChanged: false })).toBe(false);
    });
    it('is false when the local side changed even though the remote id equals the base', () => {
      expect(fileSameContent({
        localHash: 'h2', remote: remoteInfo({ etag: 'etag-1' }), base: baseState({ remoteId: 'etag-1' }), localChanged: true,
      })).toBe(false);
    });
    it('is false when nothing proves identity', () => {
      expect(fileSameContent({
        localHash: 'h1', remote: remoteInfo({ checksum: 'other' }), base: null, localChanged: false,
      })).toBe(false);
    });
  });

  describe('decideBundleDirection', () => {
    it('row 1: no manifest on either side gives null', () => {
      expect(decideBundleDirection(input({ local: null, remote: null }))).toBeNull();
    });
    it('row 2: same content gives null even when both sides changed', () => {
      expect(decideBundleDirection(input({ sameContent: true }))).toBeNull();
    });
    it('row 3: only the local side changed gives local', () => {
      expect(decideBundleDirection(input({ localChanged: true, remoteChanged: false }))).toBe('local');
    });
    it('row 4: only the remote side changed gives remote', () => {
      expect(decideBundleDirection(input({ localChanged: false, remoteChanged: true }))).toBe('remote');
    });
    it('row 5: neither side changed gives null', () => {
      expect(decideBundleDirection(input({ localChanged: false, remoteChanged: false }))).toBeNull();
    });
    it('row 6: both changed and the local manifest is gone gives remote', () => {
      expect(decideBundleDirection(input({ local: null }))).toBe('remote');
    });
    it('row 7: both changed and the remote manifest is gone gives local', () => {
      expect(decideBundleDirection(input({ remote: null }))).toBe('local');
    });
    it('rows 3 and 4 win over rows 6 and 7', () => {
      expect(decideBundleDirection(input({ remote: null, localChanged: true, remoteChanged: false }))).toBe('local');
      expect(decideBundleDirection(input({ local: null, localChanged: false, remoteChanged: true }))).toBe('remote');
      expect(decideBundleDirection(input({ remote: null, localChanged: false, remoteChanged: true }))).toBe('remote');
      expect(decideBundleDirection(input({ local: null, localChanged: true, remoteChanged: false }))).toBe('local');
    });
    it('row 8: the higher semver version wins', () => {
      expect(decideBundleDirection(input({ local: side('1.2.0'), remote: side('1.1.0') }))).toBe('local');
      expect(decideBundleDirection(input({ local: side('1.1.0'), remote: side('1.2.0') }))).toBe('remote');
      expect(decideBundleDirection(input({ local: side('1.2.0-beta.1'), remote: side('1.2.0') }))).toBe('remote');
    });
    it('row 8 beats the mtime comparison', () => {
      expect(decideBundleDirection(input({ local: side('1.0.0', 99_000), remote: side('1.1.0', 1_000) }))).toBe('remote');
    });
    it('row 9: equal versions fall back to the newer mtime at second precision', () => {
      expect(decideBundleDirection(input({ local: side('1.0.0', 20_000), remote: side('1.0.0', 10_000) }))).toBe('local');
      expect(decideBundleDirection(input({ local: side('1.0.0', 10_000), remote: side('1.0.0', 20_000) }))).toBe('remote');
    });
    it('row 9 boundary: the same second holds, the next second wins', () => {
      expect(decideBundleDirection(input({ local: side('1.0.0', 10_999), remote: side('1.0.0', 10_000) }))).toBe('hold');
      expect(decideBundleDirection(input({ local: side('1.0.0', 11_000), remote: side('1.0.0', 10_999) }))).toBe('local');
    });
    it('treats unparsable versions as equal and falls back to mtime', () => {
      expect(decideBundleDirection(input({ local: side(null, 30_000), remote: side('abc', 10_000) }))).toBe('local');
    });
    it('row 10: equal versions and equal seconds hold', () => {
      expect(decideBundleDirection(input({ local: side('1.0.0', 5_100), remote: side('1.0.0', 5_900) }))).toBe('hold');
    });
  });

  describe('planBundleFileAction', () => {
    const st = (over: Partial<BundleFileState>): BundleFileState => ({
      localPresent: true, remotePresent: true, tracked: false, sameContent: false, ...over,
    });
    type Row = [string, Parameters<typeof planBundleFileAction>[0], Partial<BundleFileState>, string];
    const rows: Row[] = [
      ['null, any state', null, {}, 'normal'],
      ['null, one side only', null, { remotePresent: false }, 'normal'],
      ['hold, both present, same content', 'hold', { sameContent: true }, 'normal'],
      ['hold, both present, not provably same', 'hold', {}, 'hold'],
      ['hold, local only', 'hold', { remotePresent: false }, 'skip'],
      ['hold, remote only', 'hold', { localPresent: false }, 'skip'],
      ['hold, neither side', 'hold', { localPresent: false, remotePresent: false }, 'skip'],
      ['remote, remote only', 'remote', { localPresent: false }, 'download'],
      ['remote, both, different', 'remote', {}, 'download'],
      ['remote, both, same', 'remote', { sameContent: true }, 'normal'],
      ['remote, local only, untracked', 'remote', { remotePresent: false, tracked: false }, 'skip'],
      ['remote, local only, tracked', 'remote', { remotePresent: false, tracked: true }, 'normal'],
      ['remote, neither side', 'remote', { localPresent: false, remotePresent: false }, 'normal'],
      ['local, local only', 'local', { remotePresent: false }, 'upload'],
      ['local, both, different', 'local', {}, 'upload'],
      ['local, both, same', 'local', { sameContent: true }, 'normal'],
      ['local, remote only, untracked', 'local', { localPresent: false, tracked: false }, 'skip'],
      ['local, remote only, tracked', 'local', { localPresent: false, tracked: true }, 'normal'],
      ['local, neither side', 'local', { localPresent: false, remotePresent: false }, 'normal'],
    ];
    it.each(rows)('%s', (_name, direction, over, expected) => {
      expect(planBundleFileAction(direction, st(over))).toBe(expected);
    });
  });
});
