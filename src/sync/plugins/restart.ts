// Pure helpers that decide which plugins need an Obsidian restart and which tracked plugin subtrees are stale (docs/spec.md §7).
import { isValidPluginId } from './pluginPaths';

// Plugins whose code was written and that are enabled (or all of them when the enabled list is unknown), sorted.
export function pluginsNeedingRestart(
  codeWritten: ReadonlySet<string>,
  enabled: ReadonlySet<string> | 'unknown',
): string[] {
  const ids = [...codeWritten].filter((id) => enabled === 'unknown' || enabled.has(id));
  return ids.sort();
}

// `<configDir>/plugins/<id>` itself or any path below it yields `<id>`; anything else yields null.
function pluginIdOfTrackedPath(path: string, configDir: string): string | null {
  const prefix = `${configDir}/plugins/`;
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length).split('/')[0];
}

// Distinct, sorted ids of tracked plugins that are valid ids but no longer active.
export function staleTrackedPluginIds(
  trackedPaths: readonly string[],
  configDir: string,
  isActive: (id: string) => boolean,
): string[] {
  const stale = new Set<string>();
  for (const path of trackedPaths) {
    const id = pluginIdOfTrackedPath(path, configDir);
    if (id !== null && isValidPluginId(id) && !isActive(id)) stale.add(id);
  }
  return [...stale].sort();
}
