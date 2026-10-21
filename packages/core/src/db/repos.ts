import {
  Explanation,
  Finding,
  FirewallDecision,
  InvariantResult,
  Patch,
  Policy,
  Run,
  ScenarioResult,
  Step,
  VerifyResult,
} from '@payclinic/contracts';
import type { FindingState } from '@payclinic/contracts';
import type { Database } from './db';

export interface Repos {
  insertRun(r: Run): void;
  getRun(id: string): Run | null;
  updateRun(id: string, patch: Partial<Run>): void;
  listRuns(): Run[];
  insertScenario(s: ScenarioResult): void;
  updateScenario(id: string, patch: Partial<ScenarioResult>): void;
  listScenarios(runId: string): ScenarioResult[];
  insertSteps(steps: Step[]): void;
  listSteps(runId: string, scenarioId?: string): Step[];
  listStepsByIds(ids: string[]): Step[];
  insertInvariantResults(runId: string, scenarioId: string, results: InvariantResult[]): void;
  insertFinding(f: Finding): void;
  getFinding(id: string): Finding | null;
  listFindings(runId: string): Finding[];
  updateFindingState(id: string, state: FindingState): void;
  upsertExplanation(e: Explanation): void;
  getExplanation(findingId: string): Explanation | null;
  insertPatch(p: Patch): void;
  getPatchForFinding(findingId: string): Patch | null;
  upsertVerify(runId: string | null, v: VerifyResult): void;
  getVerifyForPatch(patchId: string): VerifyResult | null;
  insertPolicy(runId: string, policy: Policy, yaml: string, createdAt: string): void;
  getLatestPolicy(runId: string): { policy: Policy; yaml: string } | null;
  insertDecision(d: FirewallDecision): void;
  listDecisions(runId: string): FirewallDecision[];
}

type Row = Record<string, unknown>;
type Bind = string | number | null;

const parseJson = (value: unknown): unknown =>
  value === null || value === undefined ? undefined : JSON.parse(value as string);
const asBool = (value: unknown): boolean => value === 1 || value === true;
const asBoolOrNull = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : asBool(value);

function toJson(value: unknown): string | null {
  const text = JSON.stringify(value);
  return text === undefined ? null : text;
}

function updateById(
  db: Database,
  table: string,
  id: string,
  columns: Record<string, Bind | undefined>,
): void {
  const entries = Object.entries(columns).filter(
    (entry): entry is [string, Bind] => entry[1] !== undefined,
  );
  if (entries.length === 0) return;

  const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...values, id);
}

function parseRun(row: unknown): Run {
  const r = row as Row;
  return Run.parse({
    id: r.id,
    target: r.target,
    mode: r.mode,
    scenarioKeys: parseJson(r.scenario_keys),
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    scoreBefore: r.score_before ?? undefined,
    scoreAfter: r.score_after ?? undefined,
    error: r.error ?? undefined,
  });
}

function parseScenario(row: unknown): ScenarioResult {
  const r = row as Row;
  return ScenarioResult.parse({
    id: r.id,
    runId: r.run_id,
    key: r.key,
    status: r.status,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  });
}

function parseStep(row: unknown): Step {
  const r = row as Row;
  return Step.parse({
    id: r.id,
    runId: r.run_id,
    scenarioId: r.scenario_id,
    seq: r.seq,
    actor: r.actor,
    label: r.label ?? undefined,
    method: r.method,
    url: r.url,
    requestHeaders: parseJson(r.request_headers),
    requestBody: parseJson(r.request_body),
    responseStatus: r.response_status,
    responseHeaders: parseJson(r.response_headers),
    responseBody: parseJson(r.response_body),
    paypalDebugId: r.paypal_debug_id ?? undefined,
    durationMs: r.duration_ms,
    timestamp: r.timestamp,
  });
}

function parseFinding(row: unknown): Finding {
  const r = row as Row;
  return Finding.parse({
    id: r.id,
    runId: r.run_id,
    scenarioKey: r.scenario_key,
    invariantKey: r.invariant_key,
    severity: r.severity,
    state: r.state,
    title: r.title,
    summary: r.summary,
    evidenceStepIds: parseJson(r.evidence_step_ids),
    createdAt: r.created_at,
  });
}

function parseExplanation(row: unknown): Explanation {
  const r = row as Row;
  return Explanation.parse({
    findingId: r.finding_id,
    rootCause: r.root_cause,
    impact: r.impact,
    whereInCode: parseJson(r.where_in_code),
    fixSummary: r.fix_summary,
    model: r.model,
    createdAt: r.created_at,
  });
}

function parsePatch(row: unknown): Patch {
  const r = row as Row;
  return Patch.parse({
    id: r.id,
    findingId: r.finding_id,
    edits: parseJson(r.edits),
    diff: r.diff,
    testFile: parseJson(r.test_file),
    source: r.source,
    model: r.model ?? undefined,
    rationale: r.rationale ?? undefined,
    createdAt: r.created_at,
  });
}

function parseVerify(row: unknown): VerifyResult {
  const r = row as Row;
  return VerifyResult.parse({
    patchId: r.patch_id,
    applied: asBool(r.applied),
    started: asBool(r.started),
    invariantPassed: asBool(r.invariant_passed),
    testsPassed: asBoolOrNull(r.tests_passed),
    verified: asBool(r.verified),
    durationMs: r.duration_ms,
    log: parseJson(r.log),
    rerunStepIds: parseJson(r.rerun_step_ids),
  });
}

function parseDecision(row: unknown): FirewallDecision {
  const r = row as Row;
  return FirewallDecision.parse({
    id: r.id,
    runId: r.run_id,
    action: r.action,
    ruleId: r.rule_id ?? null,
    reason: r.reason,
    request: parseJson(r.request),
    ts: r.ts,
  });
}

/** Creates typed repositories; every read validates the row with a contract schema. */
export function createRepos(db: Database): Repos {
  return {
    insertRun(r) {
      db.prepare(
        `INSERT INTO runs (id, target, mode, scenario_keys, status, started_at, completed_at, score_before, score_after, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.id,
        r.target,
        r.mode,
        JSON.stringify(r.scenarioKeys),
        r.status,
        r.startedAt,
        r.completedAt ?? null,
        r.scoreBefore ?? null,
        r.scoreAfter ?? null,
        r.error ?? null,
      );
    },

    getRun(id) {
      const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
      return row === undefined ? null : parseRun(row);
    },

    updateRun(id, patch) {
      updateById(db, 'runs', id, {
        target: patch.target,
        mode: patch.mode,
        scenario_keys:
          patch.scenarioKeys === undefined ? undefined : JSON.stringify(patch.scenarioKeys),
        status: patch.status,
        started_at: patch.startedAt,
        completed_at: patch.completedAt,
        score_before: patch.scoreBefore,
        score_after: patch.scoreAfter,
        error: patch.error,
      });
    },

    listRuns() {
      const rows = db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as Row[];
      return rows.map(parseRun);
    },

    insertScenario(s) {
      db.prepare(
        `INSERT INTO scenarios (id, run_id, key, status, started_at, finished_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.id,
        s.runId,
        s.key,
        s.status,
        s.startedAt ?? null,
        s.finishedAt ?? null,
        s.error ?? null,
      );
    },

    updateScenario(id, patch) {
      updateById(db, 'scenarios', id, {
        run_id: patch.runId,
        key: patch.key,
        status: patch.status,
        started_at: patch.startedAt,
        finished_at: patch.finishedAt,
        error: patch.error,
      });
    },

    listScenarios(runId) {
      const rows = db
        .prepare('SELECT * FROM scenarios WHERE run_id = ? ORDER BY rowid ASC')
        .all(runId) as Row[];
      return rows.map(parseScenario);
    },

    insertSteps(steps) {
      const insert = db.prepare(
        `INSERT INTO steps (id, run_id, scenario_id, seq, actor, label, method, url, request_headers, request_body,
          response_status, response_headers, response_body, paypal_debug_id, duration_ms, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertAll = db.transaction((items: Step[]) => {
        for (const s of items) {
          insert.run(
            s.id,
            s.runId,
            s.scenarioId,
            s.seq,
            s.actor,
            s.label ?? null,
            s.method,
            s.url,
            JSON.stringify(s.requestHeaders),
            toJson(s.requestBody),
            s.responseStatus,
            JSON.stringify(s.responseHeaders),
            toJson(s.responseBody),
            s.paypalDebugId ?? null,
            s.durationMs,
            s.timestamp,
          );
        }
      });
      insertAll(steps);
    },

    listSteps(runId, scenarioId) {
      const rows = (
        scenarioId === undefined
          ? db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY scenario_id, seq').all(runId)
          : db
              .prepare(
                'SELECT * FROM steps WHERE run_id = ? AND scenario_id = ? ORDER BY scenario_id, seq',
              )
              .all(runId, scenarioId)
      ) as Row[];
      return rows.map(parseStep);
    },

    listStepsByIds(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      const rows = db
        .prepare(`SELECT * FROM steps WHERE id IN (${placeholders}) ORDER BY scenario_id, seq`)
        .all(...ids) as Row[];
      return rows.map(parseStep);
    },

    insertInvariantResults(runId, scenarioId, results) {
      const insert = db.prepare(
        `INSERT INTO invariant_results (run_id, scenario_id, key, passed, severity, message, evidence_step_ids, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertAll = db.transaction((items: InvariantResult[]) => {
        for (const r of items) {
          insert.run(
            runId,
            scenarioId,
            r.key,
            r.passed ? 1 : 0,
            r.severity,
            r.message,
            JSON.stringify(r.evidenceStepIds),
            r.details === undefined ? null : JSON.stringify(r.details),
          );
        }
      });
      insertAll(results);
    },

    insertFinding(f) {
      db.prepare(
        `INSERT INTO findings (id, run_id, scenario_key, invariant_key, severity, state, title, summary, evidence_step_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        f.id,
        f.runId,
        f.scenarioKey,
        f.invariantKey,
        f.severity,
        f.state,
        f.title,
        f.summary,
        JSON.stringify(f.evidenceStepIds),
        f.createdAt,
      );
    },

    getFinding(id) {
      const row = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
      return row === undefined ? null : parseFinding(row);
    },

    listFindings(runId) {
      const rows = db
        .prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY created_at ASC, rowid ASC')
        .all(runId) as Row[];
      return rows.map(parseFinding);
    },

    updateFindingState(id, state) {
      db.prepare('UPDATE findings SET state = ? WHERE id = ?').run(state, id);
    },

    upsertExplanation(e) {
      db.prepare(
        `INSERT INTO explanations (finding_id, root_cause, impact, where_in_code, fix_summary, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(finding_id) DO UPDATE SET
           root_cause = excluded.root_cause, impact = excluded.impact,
           where_in_code = excluded.where_in_code, fix_summary = excluded.fix_summary,
           model = excluded.model, created_at = excluded.created_at`,
      ).run(
        e.findingId,
        e.rootCause,
        e.impact,
        JSON.stringify(e.whereInCode),
        e.fixSummary,
        e.model,
        e.createdAt,
      );
    },

    getExplanation(findingId) {
      const row = db.prepare('SELECT * FROM explanations WHERE finding_id = ?').get(findingId);
      return row === undefined ? null : parseExplanation(row);
    },

    insertPatch(p) {
      db.prepare(
        `INSERT INTO patches (id, finding_id, edits, diff, test_file, source, model, rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.id,
        p.findingId,
        JSON.stringify(p.edits),
        p.diff,
        toJson(p.testFile),
        p.source,
        p.model ?? null,
        p.rationale ?? null,
        p.createdAt,
      );
    },

    getPatchForFinding(findingId) {
      const row = db
        .prepare(
          'SELECT * FROM patches WHERE finding_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
        )
        .get(findingId);
      return row === undefined ? null : parsePatch(row);
    },

    upsertVerify(_runId, v) {
      db.prepare(
        `INSERT INTO verify_results (patch_id, applied, started, invariant_passed, tests_passed, verified, duration_ms, log, rerun_step_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(patch_id) DO UPDATE SET
           applied = excluded.applied, started = excluded.started,
           invariant_passed = excluded.invariant_passed, tests_passed = excluded.tests_passed,
           verified = excluded.verified, duration_ms = excluded.duration_ms,
           log = excluded.log, rerun_step_ids = excluded.rerun_step_ids`,
      ).run(
        v.patchId,
        v.applied ? 1 : 0,
        v.started ? 1 : 0,
        v.invariantPassed ? 1 : 0,
        v.testsPassed === null ? null : v.testsPassed ? 1 : 0,
        v.verified ? 1 : 0,
        v.durationMs,
        JSON.stringify(v.log),
        JSON.stringify(v.rerunStepIds),
      );
    },

    getVerifyForPatch(patchId) {
      const row = db.prepare('SELECT * FROM verify_results WHERE patch_id = ?').get(patchId);
      return row === undefined ? null : parseVerify(row);
    },

    insertPolicy(runId, policy, yaml, createdAt) {
      db.prepare('INSERT INTO policies (run_id, policy, yaml, created_at) VALUES (?, ?, ?, ?)').run(
        runId,
        JSON.stringify(policy),
        yaml,
        createdAt,
      );
    },

    getLatestPolicy(runId) {
      const row = db
        .prepare(
          'SELECT * FROM policies WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        )
        .get(runId) as Row | undefined;
      if (row === undefined) return null;
      return { policy: Policy.parse(parseJson(row.policy)), yaml: row.yaml as string };
    },

    insertDecision(d) {
      db.prepare(
        `INSERT INTO firewall_decisions (id, run_id, action, rule_id, reason, request, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(d.id, d.runId, d.action, d.ruleId, d.reason, JSON.stringify(d.request), d.ts);
    },

    listDecisions(runId) {
      const rows = db
        .prepare('SELECT * FROM firewall_decisions WHERE run_id = ? ORDER BY ts ASC, rowid ASC')
        .all(runId) as Row[];
      return rows.map(parseDecision);
    },
  };
}
