import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PatchOutput, type Explanation, type Finding, type Patch } from '@payclinic/contracts';
import {
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  type Database,
  type Prescriber,
} from '@payclinic/core';
import { createApi } from '@payclinic/cli';
import { SCENARIOS } from '../../scenarios';
import { describeApiContract } from './api-contract';

const repoRoot = join(__dirname, '../..');
const workspaceRoot = join(repoRoot, '.payclinic-tmp', 'contract-workspace');
const iso = '2026-10-18T10:00:00.000Z';
const reference = PatchOutput.parse(
  JSON.parse(readFileSync(join(repoRoot, 'fixtures/patches/B2.json'), 'utf8')),
);

function testPrescriber(newId: () => string): Prescriber {
  const explanation = (finding: Finding): Explanation => ({
    findingId: finding.id,
    rootCause: 'The store trusts the browser total.',
    impact: 'A customer can pay less than the cart total.',
    whereInCode: { file: reference.edits[0]!.file, hint: 'resolveAmount' },
    fixSummary: 'Always use the server total.',
    model: 'test',
    createdAt: iso,
  });
  const patch = (finding: Finding): Patch => ({
    id: newId(),
    findingId: finding.id,
    edits: reference.edits,
    diff: '--- a\n+++ b\n',
    source: 'template',
    createdAt: iso,
  });

  return async (finding) => ({ explanation: explanation(finding), patches: [patch(finding)] });
}

async function start() {
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(join(workspaceRoot, 'apps'), { recursive: true });
  cpSync(join(repoRoot, 'apps', 'buggy-store'), join(workspaceRoot, 'apps', 'buggy-store'), {
    recursive: true,
  });

  let n = 0;
  const newId = () => `contract-${++n}`;
  const db: Database = openDb(':memory:');
  const repos = createRepos(db);
  const bus = new EventEmitter();
  const config = loadConfig({});
  const orchestrator = createOrchestrator({
    repos,
    config,
    scenarios: SCENARIOS,
    repoRoot: workspaceRoot,
    storeSourceDir: join(workspaceRoot, 'apps/buggy-store'),
    prescriber: testPrescriber(newId),
    newId,
    now: () => new Date(iso),
    bus,
  });
  const app = createApi({ orchestrator, repos, config, bus, version: 'test' });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });

  return {
    baseUrl,
    async close() {
      await app.close();
      db.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

describeApiContract('real server', start);
