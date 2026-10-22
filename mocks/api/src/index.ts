import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { z } from 'zod';
import {
  DecisionList,
  FindingDetail,
  Health,
  OpenPrResponse,
  PolicyResponse,
  RunCreateRequest,
  RunCreateResponse,
  RunDetail,
  RunEvent,
  RunSummary,
  SCENARIO_META,
  SEVERITY_POINTS,
  ScenarioInfo,
  StepList,
  type Finding,
  type FirewallDecision,
  type Policy,
  type Run,
  type ScenarioKey,
  type ScenarioResult,
  type Score,
  type Step,
} from '@payclinic/contracts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_DATA_PATH = join(REPO_ROOT, 'fixtures/mock/mock-data.json');
const ALLOWED_ORIGIN = 'http://localhost:5173';
const PRESCRIBE_STEPS = ['explaining', 'patching', 'verifying', 'done'] as const;

interface MockData {
  runs: RunSummary[];
  details: Record<string, RunDetail>;
  findingDetails: Record<string, FindingDetail>;
  steps: Record<string, Step[]>;
  policies: Record<string, { policy: Policy | null; yaml: string | null }>;
  decisions: Record<string, FirewallDecision[]>;
}

interface Channel {
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
  timers: NodeJS.Timeout[];
}

const nowIso = () => new Date().toISOString();

function scoreFor(findings: Finding[]): Score {
  const unresolved = findings.filter(
    (f) => f.state === 'open' || f.state === 'patched' || f.state === 'unverified',
  );
  const seen = new Set<string>();
  const penalties: Score['penalties'] = [];
  for (const finding of unresolved) {
    if (seen.has(finding.invariantKey)) continue;
    seen.add(finding.invariantKey);
    penalties.push({
      invariantKey: finding.invariantKey,
      severity: finding.severity,
      points: SEVERITY_POINTS[finding.severity],
    });
  }
  const total = penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  return {
    score: Math.max(0, 100 - total),
    penalties,
    unresolvedCount: unresolved.length,
    resolvedCount: findings.length - unresolved.length,
  };
}

function historyEvents(detail: RunDetail): RunEvent[] {
  return [
    { type: 'run.started', run: detail.run },
    ...detail.scenarios.map((scenario) => ({ type: 'scenario.started' as const, scenario })),
    ...detail.findings.map((finding) => ({ type: 'finding.created' as const, finding })),
    { type: 'score.updated', score: detail.score },
    { type: 'run.completed', run: detail.run },
  ];
}

/**
 * Serves the REST + SSE contract from fixtures/mock/mock-data.json so the dashboard can
 * run entirely without the real engine.
 */
export function createMockApi(opts: { dataPath?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const data = JSON.parse(readFileSync(opts.dataPath ?? DEFAULT_DATA_PATH, 'utf8')) as MockData;
  const channels = new Map<string, Channel>();
  const clients = new Set<ServerResponse>();
  let runCounter = data.runs.length;

  const send = <T>(reply: FastifyReply, schema: z.ZodType<T>, value: unknown) =>
    reply.send(schema.parse(value));
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not found' });

  const channelFor = (runId: string): Channel => {
    const existing = channels.get(runId);
    if (existing) return existing;
    const channel: Channel = { events: [], subscribers: new Set(), timers: [] };
    channels.set(runId, channel);
    return channel;
  };

  const emit = (runId: string, event: RunEvent) => {
    const validated = RunEvent.parse(event);
    const channel = channelFor(runId);
    channel.events.push(validated);
    for (const subscriber of channel.subscribers) subscriber(validated);
  };

  const schedule = (runId: string, events: RunEvent[], delayMs: number) => {
    const channel = channelFor(runId);
    events.forEach((event, index) => {
      const timer = setTimeout(() => emit(runId, event), index * delayMs);
      timer.unref();
      channel.timers.push(timer);
    });
  };

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', ALLOWED_ORIGIN);
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') reply.code(204).send();
  });

  app.addHook('onClose', async () => {
    for (const channel of channels.values()) {
      for (const timer of channel.timers) clearTimeout(timer);
    }
    for (const client of clients) client.destroy();
  });

  app.get('/api/health', async (_request, reply) =>
    send(reply, Health, {
      ok: true,
      mode: 'offline',
      version: 'mock',
      aiProvider: 'fixture',
    }),
  );

  app.get('/api/runs', async (_request, reply) => send(reply, RunSummary.array(), data.runs));

  app.post('/api/runs', async (request, reply) => {
    const parsed = RunCreateRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid run request' });
    const requestBody = parsed.data;
    const base = data.details['run-1'];
    if (!base) return reply.code(500).send({ error: 'mock data is missing run-1' });

    let runId: string;
    do {
      runId = `run-${++runCounter}`;
    } while (data.details[runId]);

    const scenarios: ScenarioResult[] = requestBody.scenarios.map((key) => {
      const existing = base.scenarios.find((scenario) => scenario.key === key);
      return {
        id: `${runId}-scn-${key}`,
        runId,
        key,
        status: 'running',
        startedAt: existing?.startedAt ?? nowIso(),
      };
    });
    const findings: Finding[] = base.findings
      .filter((finding) => requestBody.scenarios.includes(finding.scenarioKey))
      .map((finding, index) => ({
        ...finding,
        id: `fnd-${runId}-${index + 1}`,
        runId,
        state: 'open',
      }));
    const score = scoreFor(findings);
    const run: Run = {
      id: runId,
      target: requestBody.target,
      mode: requestBody.mode,
      scenarioKeys: requestBody.scenarios,
      status: 'running',
      startedAt: nowIso(),
    };
    data.details[runId] = RunDetail.parse({ run, scenarios, findings, score });
    data.runs.push(RunSummary.parse({ ...run, findingCount: findings.length, score }));

    const completedRun: Run = { ...run, status: 'completed', completedAt: nowIso() };
    const events: RunEvent[] = [
      { type: 'run.started', run },
      ...scenarios.map((scenario) => ({ type: 'scenario.started' as const, scenario })),
      ...findings.map((finding) => ({ type: 'finding.created' as const, finding })),
      { type: 'score.updated', score },
      { type: 'run.completed', run: completedRun },
    ];
    schedule(runId, events, 300);

    const finish = setTimeout(() => {
      const detail = data.details[runId];
      if (!detail) return;
      const finishedScenarios = detail.scenarios.map((scenario) => ({
        ...scenario,
        status: findings.some((finding) => finding.scenarioKey === scenario.key)
          ? ('failed' as const)
          : ('passed' as const),
        finishedAt: completedRun.completedAt,
      }));
      data.details[runId] = { ...detail, run: completedRun, scenarios: finishedScenarios };
      const index = data.runs.findIndex((summary) => summary.id === runId);
      if (index >= 0) {
        data.runs[index] = RunSummary.parse({
          ...completedRun,
          findingCount: findings.length,
          score,
        });
      }
    }, 300 * Math.max(1, events.length - 1));
    finish.unref();
    channelFor(runId).timers.push(finish);

    return reply.code(202).send(RunCreateResponse.parse({ runId }));
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.details[id];
    if (!detail) return notFound(reply);
    return send(reply, RunDetail, detail);
  });

  app.get('/api/runs/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.details[id];
    if (!detail) return notFound(reply);
    const { scenarioId } = request.query as { scenarioId?: string };
    const steps = scenarioId
      ? (data.steps[scenarioId] ?? [])
      : detail.scenarios.flatMap((scenario) => data.steps[scenario.id] ?? []);
    return send(reply, StepList, steps);
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.details[id];
    if (!detail) return notFound(reply);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': ALLOWED_ORIGIN,
    });
    clients.add(reply.raw);

    const write = (event: RunEvent) => {
      if (reply.raw.writableEnded) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(RunEvent.parse(event))}\n\n`);
      } catch {
        return;
      }
    };

    const channel = channels.get(id);
    const buffered = channel ? channel.events : historyEvents(detail);
    for (const event of buffered) write(event);

    const followed = channel ?? channelFor(id);
    const listener = (event: RunEvent) => write(event);
    followed.subscribers.add(listener);

    const keepalive = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(':keepalive\n\n');
    }, 15_000);
    keepalive.unref();

    reply.raw.on('close', () => {
      clearInterval(keepalive);
      followed.subscribers.delete(listener);
      clients.delete(reply.raw);
    });
  });

  app.get('/api/findings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.findingDetails[id];
    if (!detail) return notFound(reply);
    return send(reply, FindingDetail, detail);
  });

  app.post('/api/findings/:id/prescribe', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.findingDetails[id];
    if (!detail) return notFound(reply);
    const finding = detail.finding;
    const sourceFinding = data.details['run-2']?.findings.find(
      (candidate) =>
        candidate.invariantKey === finding.invariantKey &&
        candidate.scenarioKey === finding.scenarioKey,
    );
    const source = sourceFinding ? data.findingDetails[sourceFinding.id] : undefined;

    PRESCRIBE_STEPS.forEach((stage, index) => {
      const timer = setTimeout(() => {
        emit(finding.runId, {
          type: 'prescribe.progress',
          findingId: id,
          stage,
          message: `${stage} ${id}`,
        });
        if (stage !== 'done') return;
        const current = data.findingDetails[id];
        if (!current) return;
        const verified: Finding = { ...current.finding, state: 'verified' };
        const patch = source?.patch
          ? { ...source.patch, id: `pat-${id}`, findingId: id }
          : current.patch;
        data.findingDetails[id] = {
          finding: verified,
          steps: current.steps,
          explanation: source?.explanation
            ? { ...source.explanation, findingId: id }
            : current.explanation,
          patch,
          verify:
            source?.verify && patch ? { ...source.verify, patchId: patch.id } : current.verify,
        };
        const runDetail = data.details[verified.runId];
        if (runDetail) {
          data.details[verified.runId] = {
            ...runDetail,
            findings: runDetail.findings.map((item) => (item.id === id ? verified : item)),
          };
        }
      }, index * 400);
      timer.unref();
      channelFor(finding.runId).timers.push(timer);
    });

    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/findings/:id/open-pr', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!data.findingDetails[id]) return notFound(reply);
    return send(reply, OpenPrResponse, {
      prUrl: null,
      reason: 'Mock API: pull requests are not created in offline mode.',
    });
  });

  app.post('/api/runs/:id/protect', async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = data.details[id];
    if (!detail) return notFound(reply);
    if (detail.run.target !== 'agent') {
      return reply.code(400).send({ error: 'protect is only available for agent runs' });
    }
    const findings: Finding[] = detail.findings.map((finding) => ({
      ...finding,
      state: 'protected',
    }));
    data.details[id] = { ...detail, findings };
    for (const finding of findings) {
      const stored = data.findingDetails[finding.id];
      if (stored) data.findingDetails[finding.id] = { ...stored, finding };
    }
    const decision = data.decisions[id]?.[0];
    if (decision) emit(id, { type: 'decision.recorded', decision });
    emit(id, { type: 'score.updated', score: detail.score });
    return reply.code(202).send({ accepted: true });
  });

  app.get('/api/runs/:id/policy', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!data.details[id]) return notFound(reply);
    return send(reply, PolicyResponse, data.policies[id] ?? { policy: null, yaml: null });
  });

  app.get('/api/runs/:id/decisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!data.details[id]) return notFound(reply);
    return send(reply, DecisionList, data.decisions[id] ?? []);
  });

  app.get('/api/scenarios', async (_request, reply) => {
    const scenarios = (Object.keys(SCENARIO_META) as ScenarioKey[]).map((key) => ({
      key,
      title: SCENARIO_META[key].title,
      target: SCENARIO_META[key].target,
      description: SCENARIO_META[key].description,
    }));
    return send(reply, ScenarioInfo.array(), scenarios);
  });

  return app;
}
