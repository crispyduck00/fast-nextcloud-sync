// Pure path helpers for community plugin bundles under `<configDir>/plugins/<id>/` (docs/spec.md §7).

export const PLUGIN_BUNDLE_FILES = ['manifest.json', 'main.js', 'styles.css', 'data.json'] as const;
export type PluginBundleFile = (typeof PLUGIN_BUNDLE_FILES)[number];
export const PLUGIN_CODE_FILES = ['manifest.json', 'main.js', 'styles.css'] as const;
export type PluginCodeFile = (typeof PLUGIN_CODE_FILES)[number];
export interface PluginFileRef {
  id: string;
  file: PluginBundleFile;
}

export function isValidPluginId(id: string): boolean {
  return id !== '' && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.startsWith('.');
}

export function isPluginCodeFile(file: PluginBundleFile): file is PluginCodeFile {
  return (PLUGIN_CODE_FILES as readonly string[]).includes(file);
}

function isBundleFile(file: string): file is PluginBundleFile {
  return (PLUGIN_BUNDLE_FILES as readonly string[]).includes(file);
}

// `rel` is relative to the config folder, e.g. `plugins/<id>/main.js`.
export function parsePluginRel(rel: string): PluginFileRef | null {
  const parts = rel.split('/');
  if (parts.length !== 3 || parts[0] !== 'plugins') return null;
  const [, id, file] = parts;
  if (!isValidPluginId(id) || !isBundleFile(file)) return null;
  return { id, file };
}

export function parsePluginPath(path: string, configDir: string): PluginFileRef | null {
  const prefix = `${configDir}/`;
  if (!path.startsWith(prefix)) return null;
  return parsePluginRel(path.slice(prefix.length));
}

export function isUnderPluginsDir(path: string, configDir: string): boolean {
  const dir = `${configDir}/plugins`;
  return path === dir || path.startsWith(`${dir}/`);
}

export function pluginDirPath(id: string, configDir: string): string {
  return `${configDir}/plugins/${id}`;
}

// A plugin data.json written locally gets the current time; every other file keeps the remote mtime.
export function localWriteMtime(
  path: string,
  remoteMtime: number | undefined,
  configDir: string,
  now: number,
): number | undefined {
  return parsePluginPath(path, configDir)?.file === 'data.json' ? now : remoteMtime;
}

// Stable split: plugin manifests go last so a plugin is only enabled after its other files are in place.
export function partitionPluginManifestsLast<T>(
  items: readonly T[],
  pathOf: (item: T) => string,
  configDir: string,
): { rest: T[]; manifests: T[] } {
  const rest: T[] = [];
  const manifests: T[] = [];
  for (const item of items) {
    const isManifest = parsePluginPath(pathOf(item), configDir)?.file === 'manifest.json';
    (isManifest ? manifests : rest).push(item);
  }
  return { rest, manifests };
}
