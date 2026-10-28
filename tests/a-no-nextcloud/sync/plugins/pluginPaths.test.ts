import {
  PLUGIN_BUNDLE_FILES,
  PLUGIN_CODE_FILES,
  isValidPluginId,
  isPluginCodeFile,
  parsePluginRel,
  parsePluginPath,
  isUnderPluginsDir,
  pluginDirPath,
  localWriteMtime,
  partitionPluginManifestsLast,
} from '../../../../src/sync/plugins/pluginPaths';

describe('[SPEC:CPS-2] plugin paths', () => {
  it('lists the four bundle files and the three code files', () => {
    expect([...PLUGIN_BUNDLE_FILES]).toEqual(['manifest.json', 'main.js', 'styles.css', 'data.json']);
    expect([...PLUGIN_CODE_FILES]).toEqual(['manifest.json', 'main.js', 'styles.css']);
  });

  it.each([
    ['dataview', true],
    ['my-plugin_1', true],
    ['', false],
    ['a/b', false],
    ['a\\b', false],
    ['..', false],
    ['a..b', false],
    ['.hidden', false],
  ])('isValidPluginId(%j) = %s', (id, expected) => {
    expect(isValidPluginId(id)).toBe(expected);
  });

  it.each(['manifest.json', 'main.js', 'styles.css', 'data.json'])('parsePluginRel accepts plugins/foo/%s', (file) => {
    expect(parsePluginRel(`plugins/foo/${file}`)).toEqual({ id: 'foo', file });
  });

  it.each([
    'plugins/foo',
    'plugins/foo/',
    'plugins/foo/sub/main.js',
    'plugins/foo/other.txt',
    'plugins//main.js',
    'plugins/.x/main.js',
    'plugins/../main.js',
    'themes/foo/main.js',
    'plugins',
  ])('parsePluginRel(%j) = null', (rel) => {
    expect(parsePluginRel(rel)).toBeNull();
  });

  it.each([
    ['.obsidian/plugins/foo/data.json', '.obsidian', { id: 'foo', file: 'data.json' }],
    ['.config/plugins/foo/main.js', '.config', { id: 'foo', file: 'main.js' }],
    ['.obsidian/plugins/foo/main.js', '.config', null],
    ['notes/plugins/foo/main.js', '.obsidian', null],
  ])('parsePluginPath(%j, %j)', (path, configDir, expected) => {
    expect(parsePluginPath(path, configDir)).toEqual(expected);
  });

  it.each([
    ['.obsidian/plugins', true],
    ['.obsidian/plugins/x/y/z', true],
    ['.obsidian/pluginsx', false],
    ['.obsidian/themes/a', false],
  ])('isUnderPluginsDir(%j) = %s', (path, expected) => {
    expect(isUnderPluginsDir(path, '.obsidian')).toBe(expected);
  });

  it('pluginDirPath joins the config dir, plugins and the id', () => {
    expect(pluginDirPath('foo', '.obsidian')).toBe('.obsidian/plugins/foo');
  });

  it.each([
    ['manifest.json', true],
    ['main.js', true],
    ['styles.css', true],
    ['data.json', false],
  ] as const)('isPluginCodeFile(%s) = %s', (file, expected) => {
    expect(isPluginCodeFile(file)).toBe(expected);
  });

  describe('localWriteMtime', () => {
    const now = 5_000;
    it('uses now for a plugin data.json, even without a remote mtime', () => {
      expect(localWriteMtime('.obsidian/plugins/foo/data.json', 1_000, '.obsidian', now)).toBe(now);
      expect(localWriteMtime('.obsidian/plugins/foo/data.json', undefined, '.obsidian', now)).toBe(now);
    });
    it.each([
      '.obsidian/plugins/foo/main.js',
      '.obsidian/plugins/foo/manifest.json',
      'notes/a.md',
      '.obsidian/plugins/foo/sub/data.json',
    ])('returns the remote mtime unchanged for %s', (path) => {
      expect(localWriteMtime(path, 1_000, '.obsidian', now)).toBe(1_000);
      expect(localWriteMtime(path, undefined, '.obsidian', now)).toBeUndefined();
    });
  });

  describe('partitionPluginManifestsLast', () => {
    const id = (s: string): string => s;
    it('splits manifests from the rest, keeping the original order', () => {
      const items = [
        '.obsidian/plugins/a/manifest.json',
        'n1.md',
        '.obsidian/plugins/a/main.js',
        '.obsidian/plugins/b/manifest.json',
        'n2.md',
      ];
      expect(partitionPluginManifestsLast(items, id, '.obsidian')).toEqual({
        rest: ['n1.md', '.obsidian/plugins/a/main.js', 'n2.md'],
        manifests: ['.obsidian/plugins/a/manifest.json', '.obsidian/plugins/b/manifest.json'],
      });
    });
    it('returns two empty arrays for an empty input', () => {
      expect(partitionPluginManifestsLast([], id, '.obsidian')).toEqual({ rest: [], manifests: [] });
    });
  });
});
