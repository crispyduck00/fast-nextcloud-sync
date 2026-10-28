import { remotePluginIdsFromDirs, mergePluginCandidates, collectCommunityPluginCandidates } from '../../../../src/sync/plugins/candidates';
import type { PluginManifestInfo } from '../../../../src/sync/plugins/pluginCatalog';
import type { RemoteDirInfo } from '../../../../src/types';
import type { IWebDAVClient } from '../../../../src/network/IWebDAVClient';

function dir(path: string): RemoteDirInfo {
  return { path, fileId: null, etag: null, lastModified: 0 };
}

function manifest(over: Partial<PluginManifestInfo> = {}): PluginManifestInfo {
  return { name: 'Name', version: '1.0.0', minAppVersion: null, isDesktopOnly: false, ...over };
}

describe('[SPEC:CPS-11] plugin candidates', () => {
  describe('remotePluginIdsFromDirs', () => {
    it('keeps only direct plugin folders, deduplicated', () => {
      const dirs = [
        '.obsidian/plugins/a',
        '.obsidian/plugins/a',
        '.obsidian/plugins/b/sub',
        '.obsidian/plugins',
        '.obsidian/plugins/.x',
        '.obsidian/themes/t',
      ].map(dir);
      expect(remotePluginIdsFromDirs(dirs, '.obsidian')).toEqual(['a']);
    });

    it('returns ids in ascending order', () => {
      expect(remotePluginIdsFromDirs(['.obsidian/plugins/b', '.obsidian/plugins/a'].map(dir), '.obsidian'))
        .toEqual(['a', 'b']);
    });
  });

  describe('mergePluginCandidates', () => {
    const base = {
      localIds: ['a', 'own'],
      localManifests: new Map<string, PluginManifestInfo | null>(),
      remoteIds: ['a', 'b'] as string[] | null,
      remoteManifests: new Map<string, PluginManifestInfo | null>(),
      ownId: 'own',
      isMobile: false,
    };

    it('unions local and remote ids without the own id, with their locations', () => {
      const result = mergePluginCandidates(base);
      expect(result.candidates.map((c) => c.id)).toEqual(['a', 'b']);
      expect(result.candidates.map((c) => c.location)).toEqual(['both', 'remote']);
      expect(result.remoteAvailable).toBe(true);
    });

    it('marks a local-only id as local', () => {
      const result = mergePluginCandidates({ ...base, localIds: ['a', 'l'] });
      expect(result.candidates.find((c) => c.id === 'l')?.location).toBe('local');
    });

    it('prefers the local manifest, then the remote one, then falls back to the id', () => {
      const result = mergePluginCandidates({
        ...base,
        localIds: ['a', 'l'],
        remoteIds: ['a', 'b', 'c'],
        localManifests: new Map([['a', manifest({ name: 'Local A', version: '2.0.0' })]]),
        remoteManifests: new Map([
          ['a', manifest({ name: 'Remote A', version: '1.0.0' })],
          ['b', manifest({ name: 'Remote B', version: '3.0.0', isDesktopOnly: true })],
        ]),
      });
      const byId = new Map(result.candidates.map((c) => [c.id, c]));
      expect(byId.get('a')).toMatchObject({ name: 'Local A', version: '2.0.0', isDesktopOnly: false });
      expect(byId.get('b')).toMatchObject({ name: 'Remote B', version: '3.0.0', isDesktopOnly: true });
      expect(byId.get('c')).toMatchObject({ name: 'c', version: null, isDesktopOnly: false });
      expect(byId.get('l')).toMatchObject({ name: 'l', version: null, isDesktopOnly: false });
    });

    it('makes a desktop-only candidate unselectable on mobile only', () => {
      const manifests = new Map([['a', manifest({ isDesktopOnly: true })]]);
      const mobile = mergePluginCandidates({ ...base, isMobile: true, localManifests: manifests });
      const desktop = mergePluginCandidates({ ...base, isMobile: false, localManifests: manifests });
      expect(mobile.candidates.find((c) => c.id === 'a')?.selectable).toBe(false);
      expect(mobile.candidates.find((c) => c.id === 'b')?.selectable).toBe(true);
      expect(desktop.candidates.find((c) => c.id === 'a')?.selectable).toBe(true);
    });

    it('lists only local candidates and reports the server unavailable when remoteIds is null', () => {
      const result = mergePluginCandidates({ ...base, remoteIds: null });
      expect(result.remoteAvailable).toBe(false);
      expect(result.candidates.map((c) => c.id)).toEqual(['a']);
      expect(result.candidates[0].location).toBe('local');
    });

    it('sorts candidates by id', () => {
      const result = mergePluginCandidates({ ...base, localIds: ['z', 'm'], remoteIds: ['b'] });
      expect(result.candidates.map((c) => c.id)).toEqual(['b', 'm', 'z']);
    });
  });

  describe('collectCommunityPluginCandidates', () => {
    const CFG = '.obsidian';
    const enc = (o: object): ArrayBuffer => new TextEncoder().encode(JSON.stringify(o)).buffer as ArrayBuffer;

    function fakeLocal(ids: string[], manifests: Record<string, object> = {}, listThrows = false) {
      return {
        list: jest.fn(async (_path: string) => {
          if (listThrows) throw new Error('list failed');
          return { files: [], folders: ids.map((id) => `${CFG}/plugins/${id}`) };
        }),
        exists: jest.fn(async (path: string) => ids.some((id) => path === `${CFG}/plugins/${id}/manifest.json` && id in manifests)),
        read: jest.fn(async (path: string) => {
          const id = path.split('/')[2];
          return JSON.stringify(manifests[id]);
        }),
      };
    }

    function fakeClient(remoteIds: string[], manifests: Record<string, object | Error> = {}) {
      return {
        getDirectories: jest.fn(async () => remoteIds.map((id) => dir(`${CFG}/plugins/${id}`))),
        downloadFile: jest.fn(async (path: string) => {
          const id = path.split('/')[2];
          const m = manifests[id];
          if (m instanceof Error || m === undefined) throw m ?? new Error('missing');
          return enc(m);
        }),
      };
    }

    const deps = (localAdapter: ReturnType<typeof fakeLocal>, client: unknown) => ({
      localAdapter,
      client: client as IWebDAVClient | null,
      configDir: CFG,
      ownId: 'own',
      isMobile: false,
    });

    it('lists only local candidates with manifest data when there is no client', async () => {
      const local = fakeLocal(['a', 'own'], { a: { name: 'A', version: '1.2.3' } });
      const result = await collectCommunityPluginCandidates(deps(local, null));
      expect(result.remoteAvailable).toBe(false);
      expect(result.candidates).toEqual([
        { id: 'a', name: 'A', version: '1.2.3', isDesktopOnly: false, location: 'local', selectable: true },
      ]);
    });

    it('marks the server unavailable and does not throw when getDirectories throws', async () => {
      const local = fakeLocal(['a'], { a: { name: 'A', version: '1.0.0' } });
      const client = { getDirectories: jest.fn(async () => { throw new Error('offline'); }), downloadFile: jest.fn() };
      const result = await collectCommunityPluginCandidates(deps(local, client));
      expect(result.remoteAvailable).toBe(false);
      expect(result.candidates.map((c) => c.id)).toEqual(['a']);
      expect(client.downloadFile).not.toHaveBeenCalled();
    });

    it('downloads the manifest of a remote-only plugin once and skips ids that exist locally', async () => {
      const local = fakeLocal(['l'], { l: { name: 'L', version: '1.0.0' } });
      const client = fakeClient(['l', 'r'], { r: { name: 'Remote R', version: '4.0.0' } });
      const result = await collectCommunityPluginCandidates(deps(local, client));
      expect(client.downloadFile).toHaveBeenCalledTimes(1);
      expect(client.downloadFile).toHaveBeenCalledWith('.obsidian/plugins/r/manifest.json');
      const r = result.candidates.find((c) => c.id === 'r');
      expect(r).toMatchObject({ name: 'Remote R', version: '4.0.0', location: 'remote' });
      expect(result.candidates.find((c) => c.id === 'l')?.location).toBe('both');
      expect(result.remoteAvailable).toBe(true);
    });

    it('falls back to the id and a null version when the remote manifest cannot be fetched', async () => {
      const local = fakeLocal([]);
      const client = fakeClient(['r'], { r: new Error('404') });
      const result = await collectCommunityPluginCandidates(deps(local, client));
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ id: 'r', name: 'r', version: null });
    });

    it('returns no local candidates and does not throw when the local list throws', async () => {
      const local = fakeLocal([], {}, true);
      const result = await collectCommunityPluginCandidates(deps(local, null));
      expect(result.candidates).toEqual([]);
    });

    it('never runs more than 4 remote manifest downloads at once', async () => {
      const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
      const local = fakeLocal([]);
      let inflight = 0;
      let peak = 0;
      const client = {
        getDirectories: jest.fn(async () => ids.map((id) => dir(`${CFG}/plugins/${id}`))),
        downloadFile: jest.fn(async () => {
          inflight++;
          peak = Math.max(peak, inflight);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          inflight--;
          return enc({ name: 'N', version: '1.0.0' });
        }),
      };
      const result = await collectCommunityPluginCandidates(deps(local, client));
      expect(client.downloadFile).toHaveBeenCalledTimes(9);
      expect(result.candidates).toHaveLength(9);
      expect(peak).toBeLessThanOrEqual(4);
    });
  });
});
