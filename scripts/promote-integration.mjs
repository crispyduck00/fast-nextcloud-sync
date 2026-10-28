// Standalone packaging only. Functional changes belong to an isolated development topic.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, body) => writeFileSync(path, JSON.stringify(body, null, 2) + '\n');
function runtimeFiles() {
  const paths = [];
  function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, name.name);
      if (name.isDirectory()) walk(path);
      else paths.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  walk(resolve(root, 'src'));
  paths.push('styles.css');
  return Object.fromEntries(paths.sort().map(path => [path, hash(resolve(root, path))]));
}
function runtimeIntegrity() {
  const files = runtimeFiles();
  return { files: Object.keys(files).length, sha256Base64: createHash('sha256').update(JSON.stringify(files)).digest('base64') };
}
if (process.argv[2] === '--verify') {
  const meta = json(resolve(root, 'DEVELOPMENT-SOURCE.json'));
  if (JSON.stringify(runtimeIntegrity()) !== JSON.stringify(meta.runtime)) throw new Error('Runtime differs from the recorded development integration');
  const pkg = json(resolve(root, 'package.json'));
  const manifest = json(resolve(root, 'manifest.json'));
  if (manifest.id !== 'fast-nextcloud-sync' || pkg.version !== manifest.version || !json(resolve(root, 'versions.json'))[pkg.version]) throw new Error('Standalone identity/version metadata mismatch');
  process.stdout.write(`Verified ${meta.runtime.files} runtime files from ${meta.development.commit}\n`);
} else {
  if (!process.argv[2]) throw new Error('Usage: node scripts/promote-integration.mjs /path/to/validated/development/checkout | --verify');
  const source = resolve(process.argv[2]);
  if (source === root) throw new Error('Source must be a separate validated development checkout');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Development source has uncommitted changes');
  const upstream = 'a3d206c30c33cb2cb1f81ed71db3a60f08ee01bd';
  git('merge-base', '--is-ancestor', upstream, 'HEAD');
  const current = json(resolve(root, 'package.json'));
  const packageBase = json(resolve(source, 'package.json'));
  for (const dir of ['src', 'tests']) rmSync(resolve(root, dir), { recursive: true, force: true });
  const config = new Set(['styles.css', 'esbuild.config.mjs', 'eslint.config.mjs', 'tsconfig.json', 'tsconfig.test.json', 'jest.config.js', 'jest.b1.config.js', 'jest.b4.config.js', 'wdio.conf.mts', 'wdio.android.conf.mts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'docs/spec.md', 'docs/plan.md', 'docs/UPSTREAM-1.0.13-VALIDATION.md']);
  for (const path of git('ls-files').split('\n')) {
    if (!path.startsWith('src/') && !path.startsWith('tests/') && !config.has(path)) continue;
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    cpSync(resolve(source, path), resolve(root, path));
  }
  for (const key of ['name', 'version', 'description', 'author']) packageBase[key] = current[key];
  packageBase.scripts['verify:source'] = 'node scripts/promote-integration.mjs --verify';
  save(resolve(root, 'package.json'), packageBase);
  save(resolve(root, 'DEVELOPMENT-SOURCE.json'), {
    upstream: { repository: 'siosig/obsidian-nextcloudsync', version: '1.0.13', commit: upstream },
    development: { repository: 'crispyduck00/obsidian-nextcloudsync', branch: 'integration/all-topics', commit: git('rev-parse', 'HEAD') },
    runtime: runtimeIntegrity(),
  });
  process.stdout.write('Promoted validated source; standalone identity, release history and workflows retained.\n');
}
