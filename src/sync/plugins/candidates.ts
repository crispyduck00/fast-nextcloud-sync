import type { RemoteDirInfo } from '../../types';
import type { IWebDAVClient } from '../../network/IWebDAVClient';
import type { LocalAdapter } from '../../data/LocalAdapter';
import type { FileLogger } from '../../util/FileLogger';
import { parsePluginManifest, type PluginManifestInfo } from './pluginCatalog';
import { isValidPluginId } from './pluginPaths';

export interface PluginCandidate {
  id: string;
  /** Manifest name, or the id when no manifest is available. */
  name: string;
  version: string | null;
  isDesktopOnly: boolean;
  location: 'local' | 'remote' | 'both';
  /** False when the plugin is desktop-only and the device is mobile. */
  selectable: boolean;
}

export interface PluginCandidateList {
  /** Ascending by id; never contains this plugin's own id. */
  candidates: PluginCandidate[];
  /** Whether the remote listing could be obtained (false when logged out or offline). */
  remoteAvailable: boolean;
}

export interface MergeCandidatesInput {
  localIds: readonly string[];
  localManifests: ReadonlyMap<string, PluginManifestInfo | null>;
  remoteIds: readonly string[] | null;
  remoteManifests: ReadonlyMap<string, PluginManifestInfo | null>;
  ownId: string;
  isMobile: boolean;
}

/** Returns the ids of direct `<configDir>/plugins/<id>` folders, deduplicated and ascending. */
export function remotePluginIdsFromDirs(dirs: readonly RemoteDirInfo[], configDir: string): string[] {
  const prefix = `${configDir}/plugins/`;
  const ids = new Set<string>();
  for (const dir of dirs) {
    if (!dir.path.startsWith(prefix)) continue;
    const id = dir.path.slice(prefix.length);
    if (isValidPluginId(id)) ids.add(id);
  }
  return [...ids].sort(compareIds);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function locationOf(inLocal: boolean, inRemote: boolean): PluginCandidate['location'] {
  if (inLocal && inRemote) return 'both';
  return inLocal ? 'local' : 'remote';
}

export function mergePluginCandidates(input: MergeCandidatesInput): PluginCandidateList {
  const local = new Set(input.localIds);
  const remote = new Set(input.remoteIds ?? []);
  const ids = [...new Set([...local, ...remote])].filter((id) => id !== input.ownId).sort(compareIds);
  const candidates = ids.map((id): PluginCandidate => {
    const manifest = input.localManifests.get(id) ?? input.remoteManifests.get(id) ?? null;
    const isDesktopOnly = manifest?.isDesktopOnly ?? false;
    return {
      id,
      name: manifest?.name ?? id,
      version: manifest?.version ?? null,
      isDesktopOnly,
      location: locationOf(local.has(id), remote.has(id)),
      selectable: !(input.isMobile && isDesktopOnly),
    };
  });
  return { candidates, remoteAvailable: input.remoteIds !== null };
}

export interface CandidateDeps {
  localAdapter: Pick<LocalAdapter, 'list' | 'read' | 'exists'>;
  client: IWebDAVClient | null;
  configDir: string;
  ownId: string;
  isMobile: boolean;
  logger?: Pick<FileLogger, 'log'>;
}

const REMOTE_MANIFEST_CONCURRENCY = 4;

function logLine(deps: CandidateDeps, message: string): void {
  void deps.logger?.log(message);
}

async function readLocalIds(deps: CandidateDeps): Promise<string[]> {
  try {
    const { folders } = await deps.localAdapter.list(`${deps.configDir}/plugins`);
    const ids = folders.map((folder) => folder.slice(folder.lastIndexOf('/') + 1)).filter(isValidPluginId);
    return [...new Set(ids)].sort(compareIds);
  } catch (err) {
    logLine(deps, `plugins: local listing failed — ${(err as Error).message}`);
    return [];
  }
}

async function readLocalManifest(deps: CandidateDeps, id: string): Promise<PluginManifestInfo | null> {
  try {
    const path = `${deps.configDir}/plugins/${id}/manifest.json`;
    if (!(await deps.localAdapter.exists(path))) return null;
    return parsePluginManifest(await deps.localAdapter.read(path));
  } catch {
    return null;
  }
}

async function readRemoteIds(deps: CandidateDeps, client: IWebDAVClient): Promise<string[] | null> {
  try {
    return remotePluginIdsFromDirs(await client.getDirectories(`${deps.configDir}/plugins`), deps.configDir);
  } catch (err) {
    logLine(deps, `plugins: remote listing failed — ${(err as Error).message}`);
    return null;
  }
}

async function readRemoteManifest(deps: CandidateDeps, client: IWebDAVClient, id: string): Promise<PluginManifestInfo | null> {
  try {
    const buf = await client.downloadFile(`${deps.configDir}/plugins/${id}/manifest.json`);
    return parsePluginManifest(new TextDecoder().decode(buf));
  } catch {
    return null;
  }
}

async function readInChunks(
  ids: readonly string[],
  read: (id: string) => Promise<PluginManifestInfo | null>,
): Promise<Map<string, PluginManifestInfo | null>> {
  const out = new Map<string, PluginManifestInfo | null>();
  for (let i = 0; i < ids.length; i += REMOTE_MANIFEST_CONCURRENCY) {
    const chunk = ids.slice(i, i + REMOTE_MANIFEST_CONCURRENCY);
    const manifests = await Promise.all(chunk.map(read));
    chunk.forEach((id, j) => out.set(id, manifests[j]));
  }
  return out;
}

/** Lists the community plugins installed on this device and on the server; never throws. */
export async function collectCommunityPluginCandidates(deps: CandidateDeps): Promise<PluginCandidateList> {
  const localIds = await readLocalIds(deps);
  const localManifests = new Map<string, PluginManifestInfo | null>();
  for (const id of localIds) localManifests.set(id, await readLocalManifest(deps, id));
  const remoteIds = deps.client ? await readRemoteIds(deps, deps.client) : null;
  const client = deps.client;
  const remoteOnly = remoteIds && client ? remoteIds.filter((id) => !localManifests.has(id)) : [];
  const remoteManifests = client
    ? await readInChunks(remoteOnly, (id) => readRemoteManifest(deps, client, id))
    : new Map<string, PluginManifestInfo | null>();
  return mergePluginCandidates({ localIds, localManifests, remoteIds, remoteManifests, ownId: deps.ownId, isMobile: deps.isMobile });
}
