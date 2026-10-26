import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  INVARIANT_META,
  PatchOutput,
  SCENARIO_META,
  ScenarioKey,
  RunTarget,
  type CliReport,
  type Finding,
  type Patch,
  type RunMode,
} from '@payclinic/contracts';
import { createVerify, loadConfig } from '@payclinic/core';
import { SCENARIOS } from '../../../scenarios';
import { buildRuntime } from './wire';
import { buildReport } from './report';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REFERENCE_KEYS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const MERCHANT_SCENARIOS: ScenarioKey[] = ['B1', 'B2', 'B3', 'B4', 'B5'];
const AGENT_SCENARIOS: ScenarioKey[] = ['A1', 'A2'];
const RESOLVED_STATES = new Set(['verified', 'protected']);

const USAGE = `Usage:
  payclinic run [--target store|agent] [--scenarios B1,B2] [--offline|--online] [--fix] [--json] [--fail-on-findings]
  payclinic verify-reference
  payclinic serve`;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface RunOptions {
  target: RunTarget;
  mode: RunMode;
  scenarios: ScenarioKey[];
  fix: boolean;
  json: boolean;
  failOnFindings: boolean;
}

function optionValue(
  args: string[],
  index: number,
  flag: string,
  inline: string | undefined,
): [string, number] {
  if (inline !== undefined) {
    if (inline === '') throw new UsageError(`${flag} requires a value`);
    return [inline, index];
  }
  const next = args[index + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new UsageError(`${flag} requires a value`);
  }
  return [next, index + 1];
}

function parseScenarios(raw: string): ScenarioKey[] {
  const keys = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (keys.length === 0) throw new UsageError('--scenarios requires at least one scenario');
  return keys.map((key) => {
    const parsed = ScenarioKey.safeParse(key);
    if (!parsed.success) throw new UsageError(`Unknown scenario: ${key}`);
    return parsed.data;
  });
}

function parseRunArgs(args: string[]): RunOptions {
  let target: RunTarget = 'store';
  let mode: RunMode = 'offline';
  let scenarios: ScenarioKey[] = [];
  let fix = false;
  let json = false;
  let failOnFindings = false;

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index]!;
    if (!raw.startsWith('--')) throw new UsageError(`Unexpected argument: ${raw}`);

    const separator = raw.indexOf('=');
    const flag = separator === -1 ? raw : raw.slice(0, separator);
    const inline = separator === -1 ? undefined : raw.slice(separator + 1);

    switch (flag) {
      case '--target': {
        const [value, nextIndex] = optionValue(args, index, flag, inline);
        const parsed = RunTarget.safeParse(value);
        if (!parsed.success) throw new UsageError(`Unknown target: ${value}`);
        target = parsed.data;
        index = nextIndex;
        break;
      }
      case '--scenarios': {
        const [value, nextIndex] = optionValue(args, index, flag, inline);
        scenarios = parseScenarios(value);
        index = nextIndex;
        break;
      }
      case '--offline':
        mode = 'offline';
        break;
      case '--online':
        mode = 'online';
        break;
      case '--fix':
        fix = true;
        break;
      case '--json':
        json = true;
        break;
      case '--fail-on-findings':
        failOnFindings = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${flag}`);
    }
  }

  if (scenarios.length === 0) {
    scenarios = target === 'agent' ? AGENT_SCENARIOS : MERCHANT_SCENARIOS;
  }

  return { target, mode, scenarios, fix, json, failOnFindings };
}

function formatHumanReport(report: CliReport): string {
  const lines = [
    `PayClinic run ${report.runId}`,
    `Mode: ${report.mode}`,
    `Score: ${report.score}` +
      (report.scoreAfter === undefined ? '' : ` -> ${report.scoreAfter} after fix`),
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push('Severity  Invariant  Scenario  State       Title');
    for (const finding of report.findings) {
      lines.push(
        `${finding.severity.padEnd(9)} ${finding.invariant.padEnd(10)} ` +
          `${finding.scenario.padEnd(9)} ${finding.state.padEnd(11)} ${finding.title}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

async function runCommand(options: RunOptions): Promise<number> {
  const runtime = buildRuntime({ ...process.env, PAYCLINIC_MODE: options.mode });
  const runId = runtime.orchestrator.startRun({
    target: options.target,
    mode: options.mode,
    scenarios: options.scenarios,
  });
  await runtime.orchestrator.idle();

  const run = runtime.repos.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== 'completed') {
    process.stderr.write(
      `payclinic: run ${runId} ${run.status}${run.error === undefined ? '' : `: ${run.error}`}\n`,
    );
    return 1;
  }

  if (options.fix) {
    for (const finding of runtime.repos.listFindings(runId)) {
      if (!RESOLVED_STATES.has(finding.state)) {
        await runtime.orchestrator.prescribe(finding.id);
      }
    }
  }

  const report = buildReport(runId, runtime.repos);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(formatHumanReport(report));
  }

  const unresolved = runtime.repos
    .listFindings(runId)
    .some((finding) => !RESOLVED_STATES.has(finding.state));
  return options.failOnFindings && unresolved ? 2 : 0;
}

function referenceFinding(key: (typeof REFERENCE_KEYS)[number]): Finding {
  const invariantKey = SCENARIO_META[key].invariantKeys[0]!;
  return {
    id: `verify-reference-${key}`,
    runId: 'verify-reference',
    scenarioKey: key,
    invariantKey,
    severity: INVARIANT_META[invariantKey].severity,
    state: 'open',
    title: SCENARIO_META[key].title,
    summary: `Reference patch verification for ${key}`,
    evidenceStepIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

async function verifyReferenceCommand(): Promise<number> {
  const config = loadConfig({ PAYCLINIC_MODE: 'offline' });
  const { verify } = createVerify({
    repoRoot: REPO_ROOT,
    config,
    scenarios: SCENARIOS,
    newId: () => randomUUID(),
    now: () => new Date(),
  });

  const rows: { key: string; verified: boolean; seconds: string }[] = [];
  for (const key of REFERENCE_KEYS) {
    const path = join(REPO_ROOT, 'fixtures', 'patches', `${key}.json`);
    const startedAt = Date.now();
    try {
      if (!existsSync(path)) throw new Error(`Reference patch not found: ${path}`);
      const reference = PatchOutput.parse(JSON.parse(readFileSync(path, 'utf8')));
      const finding = referenceFinding(key);
      const patch: Patch = {
        id: `reference-${key}`,
        findingId: finding.id,
        edits: reference.edits,
        diff: '',
        source: 'template',
        createdAt: finding.createdAt,
      };
      const result = await verify(finding, patch, {
        mode: 'offline',
        runId: `verify-reference-${key}`,
      });
      rows.push({
        key,
        verified: result.verified,
        seconds: (result.durationMs / 1000).toFixed(1),
      });
      if (!result.verified) {
        process.stderr.write(`payclinic: ${key} failed: ${result.log.at(-1) ?? 'unknown'}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`payclinic: ${key} failed: ${message}\n`);
      rows.push({
        key,
        verified: false,
        seconds: ((Date.now() - startedAt) / 1000).toFixed(1),
      });
    }
  }

  process.stdout.write('Key  Verified  Seconds\n');
  for (const row of rows) {
    process.stdout.write(
      `${row.key.padEnd(5)}${(row.verified ? 'yes' : 'no').padEnd(10)}${row.seconds}\n`,
    );
  }
  return rows.every((row) => row.verified) ? 0 : 1;
}

/** Runs the CLI and resolves to its process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (command === '--help' || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  switch (command) {
    case 'run':
      return runCommand(parseRunArgs(rest));
    case 'verify-reference':
      if (rest.length > 0) throw new UsageError('verify-reference takes no arguments');
      return verifyReferenceCommand();
    case 'serve': {
      if (rest.length > 0) throw new UsageError('serve takes no arguments');
      const { runServer } = await import('./serve');
      await runServer();
      return 0;
    }
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`payclinic: ${message}\n`);
      if (error instanceof UsageError) process.stderr.write(`${USAGE}\n`);
      process.exitCode = 1;
    },
  );
}
