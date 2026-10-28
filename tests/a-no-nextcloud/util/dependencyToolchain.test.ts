import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseAllDocuments } from 'yaml';

const REPO_ROOT = join(__dirname, '../../..');

type Specifiers = Record<string, string>;
type LockSection = Record<string, { specifier: string; version: string }>;

function readText(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

const pkg = JSON.parse(readText('package.json')) as {
  packageManager: string;
  dependencies?: Specifiers;
  devDependencies?: Specifiers;
};

type Lock = {
  importers: Record<string, { dependencies?: LockSection; devDependencies?: LockSection }>;
};

// pnpm writes the environment lockfile as a leading YAML document; the project lockfile is the one whose root importer lists dependencies.
function readProjectLock(): Lock {
  for (const doc of parseAllDocuments(readText('pnpm-lock.yaml'))) {
    const value = doc.toJS() as Partial<Lock> | null;
    const root = value?.importers?.['.'];
    if (root?.dependencies || root?.devDependencies) {
      return value as Lock;
    }
  }
  throw new Error('pnpm-lock.yaml has no project document with root dependencies');
}

const lock = readProjectLock();

// Resolved version of a root importer dependency, without the peer-dependency suffix.
function lockedVersion(name: string): string | undefined {
  const root = lock.importers['.'];
  const entry = root.dependencies?.[name] ?? root.devDependencies?.[name];
  return entry?.version.split('(')[0];
}

// The "Development toolchain" section of the spec: from its heading up to the next "## " heading.
function toolchainSection(): string {
  const spec = readText('docs/spec.md');
  const start = spec.search(/^## §20\./m);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = spec.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('[SPEC:DEP-1] held dependencies', () => {
  it('[SPEC:DEP-1] typescript stays on 6.0.3', () => {
    expect(lockedVersion('typescript')).toBe('6.0.3');
  });

  it.each(['@wdio/appium-service', '@wdio/cli', '@wdio/local-runner', '@wdio/mocha-framework'])(
    '[SPEC:DEP-1] %s stays on 9.31.6',
    (name) => {
      expect(lockedVersion(name)).toBe('9.31.6');
    },
  );

  it('[SPEC:DEP-1] manifest.json keeps minAppVersion at 1.13.0', () => {
    const manifest = JSON.parse(readText('manifest.json')) as { minAppVersion: string };
    expect(manifest.minAppVersion).toBe('1.13.0');
  });

  it('[SPEC:DEP-1] every dependency specifier in package.json is a caret range', () => {
    const offenders: string[] = [];
    for (const section of [pkg.dependencies ?? {}, pkg.devDependencies ?? {}]) {
      for (const [name, specifier] of Object.entries(section)) {
        if (!specifier.startsWith('^')) {
          offenders.push(`${name}@${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('[SPEC:DEP-5] toolchain agreement', () => {
  it('[SPEC:DEP-5] packageManager is a pinned pnpm version that the spec toolchain table states', () => {
    const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager);
    expect(match).not.toBeNull();
    const pnpmRow = toolchainSection()
      .split('\n')
      .find((line) => line.startsWith('| pnpm |'));
    expect(pnpmRow).toBeDefined();
    expect(pnpmRow).toContain(match![1]);
  });

  it('[SPEC:DEP-5] every node-version in .github/workflows is "26"', () => {
    const dir = join(REPO_ROOT, '.github/workflows');
    const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
    expect(files.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/node-version:\s*["']?([^\s"']+)["']?/g)) {
        found.push(`${file}:${m[1]}`);
      }
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((entry) => !entry.endsWith(':26'))).toEqual([]);
  });

  it('[SPEC:DEP-5] the runner Dockerfile is based on node:26-bookworm and avoids Corepack', () => {
    const dockerfile = readText('tests/docker/runner/Dockerfile');
    const froms = dockerfile
      .split('\n')
      .filter((line) => /^FROM\s/i.test(line))
      .map((line) => line.trim().split(/\s+/)[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const image of froms) {
      expect(image).toMatch(/^node:26-bookworm/);
    }
    // Comment lines may explain why Corepack is absent; only instructions are checked.
    const instructions = dockerfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(instructions).not.toMatch(/corepack/i);
    expect(instructions).not.toMatch(/pnpm@\d/);
    // The pnpm version must be derived from package.json's packageManager (single source of truth).
    expect(instructions).toMatch(/npm install -g[^\n]*packageManager/);
  });

  it('[SPEC:DEP-5] the @types/node specifier has major 26', () => {
    const specifier = pkg.devDependencies?.['@types/node'] ?? pkg.dependencies?.['@types/node'];
    expect(specifier).toBeDefined();
    expect(/(\d+)\./.exec(specifier!)?.[1]).toBe('26');
  });

  it('[SPEC:DEP-5] the spec toolchain table states Node.js 26', () => {
    const nodeRow = toolchainSection()
      .split('\n')
      .find((line) => line.startsWith('| Node.js |'));
    expect(nodeRow).toBeDefined();
    expect(nodeRow).toMatch(/^\| Node\.js \| \*\*26\*\*/);
  });
});
