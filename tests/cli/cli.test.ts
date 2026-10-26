import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliReport } from '@payclinic/contracts';

const repoRoot = join(__dirname, '../..');
const cliPath = join(repoRoot, 'packages', 'cli', 'src', 'cli.ts');

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  const dir = mkdtempSync(join(tmpdir(), 'payclinic-cli-'));
  const dbPath = join(dir, 'payclinic.db');

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DB_PATH: dbPath,
        PAYCLINIC_MODE: 'offline',
        AI_PROVIDER: 'fixture',
        BUYER_APPROVER: 'sim',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

describe('payclinic cli', () => {
  it('runs B2 and prints a CliReport with score 90 and no scoreAfter', async () => {
    const result = await runCli(['run', '--scenarios', 'B2', '--offline', '--json']);
    expect(result.code, result.stderr).toBe(0);
    const report = CliReport.parse(JSON.parse(result.stdout.trim()));
    expect(report.score).toBe(90);
    expect(report.scoreAfter).toBeUndefined();
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ invariant: 'I-02', state: 'open' });
  }, 180_000);

  it('prescribes with --fix and reports scoreAfter 100 with the finding verified', async () => {
    const result = await runCli(['run', '--scenarios', 'B2', '--offline', '--fix', '--json']);
    expect(result.code, result.stderr).toBe(0);
    const report = CliReport.parse(JSON.parse(result.stdout.trim()));
    expect(report.scoreAfter).toBe(100);
    expect(report.findings[0]).toMatchObject({ invariant: 'I-02', state: 'verified' });
  }, 180_000);

  it('rejects an unknown scenario on stderr', async () => {
    const result = await runCli(['run', '--scenarios', 'B9', '--offline', '--json']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/B9|scenario/i);
    expect(result.stdout.trim()).toBe('');
  }, 180_000);

  it('exits 2 for unresolved findings with --fail-on-findings', async () => {
    const result = await runCli([
      'run',
      '--scenarios',
      'B2',
      '--offline',
      '--json',
      '--fail-on-findings',
    ]);
    expect(result.code, result.stderr).toBe(2);
    const report = CliReport.parse(JSON.parse(result.stdout.trim()));
    expect(report.findings[0]).toMatchObject({ state: 'open' });
  }, 180_000);
});
