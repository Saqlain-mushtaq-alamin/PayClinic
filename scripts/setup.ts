import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_FIXTURES = [
  'fixtures/patches/B1.json',
  'fixtures/patches/B2.json',
  'fixtures/patches/B3.json',
  'fixtures/patches/B4.json',
  'fixtures/patches/B5.json',
  'fixtures/ai/explain.B1.json',
  'fixtures/ai/explain.B2.json',
  'fixtures/ai/explain.B3.json',
  'fixtures/ai/explain.B4.json',
  'fixtures/ai/explain.B5.json',
  'fixtures/ai/patch.B1.json',
  'fixtures/ai/patch.B2.json',
  'fixtures/ai/patch.B3.json',
  'fixtures/ai/patch.B4.json',
  'fixtures/ai/patch.B5.json',
] as const;

/** Checks whether a Node version string satisfies >= 20.6. */
export function checkNodeVersion(version: string): boolean {
  const match = version.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  if (major > 20) return true;
  if (major === 20 && minor >= 6) return true;
  return false;
}

/** Returns the list of missing fixtures given an existing listing. */
export function missingFixtures(
  listing: Iterable<string>,
  required: readonly string[] = REQUIRED_FIXTURES,
): string[] {
  const normalizedSet = new Set(
    Array.from(listing).map((p) => p.replace(/\\/g, '/').replace(/^\.?\//, '')),
  );
  return required.filter((req) => {
    const normalizedReq = req.replace(/\\/g, '/');
    const withoutFixtures = normalizedReq.replace(/^fixtures\//, '');
    return !normalizedSet.has(normalizedReq) && !normalizedSet.has(withoutFixtures);
  });
}

/** Copies example env file to envPath if envPath does not already exist. */
export function copyEnvIfMissing(envPath: string, examplePath: string): boolean {
  if (existsSync(envPath)) {
    return false;
  }
  const content = readFileSync(examplePath, 'utf8');
  writeFileSync(envPath, content, 'utf8');
  return true;
}

/** Runs the setup steps: version check, directories, env, fixture checks, and dashboard build. */
export function runSetup(repoRoot: string): void {
  if (!checkNodeVersion(process.version)) {
    process.stderr.write(
      `Error: Node version >= 20.6 is required. Current version is ${process.version}.\n`,
    );
    process.exit(1);
  }

  const dataDir = join(repoRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  const envPath = join(repoRoot, '.env');
  const examplePath = join(repoRoot, '.env.example');
  if (existsSync(examplePath)) {
    if (copyEnvIfMissing(envPath, examplePath)) {
      process.stdout.write('Created .env from .env.example\n');
    } else {
      process.stdout.write('.env already exists (preserving existing file)\n');
    }
  }

  const existingFixtures = REQUIRED_FIXTURES.filter((relPath) =>
    existsSync(join(repoRoot, relPath)),
  );
  const missing = missingFixtures(existingFixtures);
  if (missing.length > 0) {
    process.stderr.write('Error: Required fixture files are missing:\n');
    for (const f of missing) {
      process.stderr.write(`  - ${f}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('Building dashboard...\n');
  const buildResult = spawnSync('npm', ['run', 'build', '-w', '@payclinic/dashboard'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  if (buildResult.status !== 0) {
    process.stderr.write('Error: Dashboard build failed.\n');
    process.exit(buildResult.status ?? 1);
  }

  process.stdout.write('\nSetup completed successfully!\n');
  process.stdout.write('To start the demo, run:\n\n');
  process.stdout.write('  npm run demo\n\n');
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  runSetup(repoRoot);
}

