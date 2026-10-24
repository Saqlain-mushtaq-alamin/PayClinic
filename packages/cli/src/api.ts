import type { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
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
  ScenarioInfo,
  StepList,
  type Finding,
  type ScenarioKey,
  type ScenarioResult,
  type Score,
} from '@payclinic/contracts';
import {
  ProtectNotApplicableError,
  ProtectNotConfiguredError,
  computeScore,
  type Config,
  type Orchestrator,
  type Repos,
} from '@payclinic/core';

const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const DEFAULT_ORIGIN = 'http://localhost:5173';

export type OpenPr = (finding: Finding) => Promise<z.infer<typeof OpenPrResponse>>;

export interface ApiDeps {
  orchestrator: Orchestrator;
  repos: Repos;
  config: Config;
  bus: EventEmitter;
  version?: string;
  openPr?: OpenPr;
}

interface SseClient {
  runId: string;
  response: ServerResponse;
  write(event: RunEvent): void;
}

function send<T>(reply: FastifyReply, schema: z.ZodType<T>, value: unknown) {
  return reply.send(schema.parse(value));
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'not found' });
}

function outputOrigin(origin: string | undefined): string {
  return origin !== undefined && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
}

function eventRunId(event: RunEvent, repos: Repos): string | null {
  switch (event.type) {
    case 'run.started':
    case 'run.completed':
      return event.run.id;
    case 'scenario.started':
    case 'scenario.finished':
      return event.scenario.runId;
    case 'step.recorded':
      return event.step.runId;
    case 'finding.created':
    case 'finding.updated':
      return event.finding.runId;
    case 'decision.recorded':
      return event.decision.runId;
    case 'run.failed':
      return event.runId;
    case 'prescribe.progress':
      return repos.getFinding(event.findingId)?.runId ?? null;
    case 'score.updated':
      return null;
  }
}

function historyEvents(
  scenarios: ScenarioResult[],
  findings: Finding[],
  score: Score,
  run: RunDetail['run'],
): RunEvent[] {
  const events: RunEvent[] = [{ type: 'run.started', run }];
  for (const scenario of scenarios) {
    events.push({ type: 'scenario.started', scenario });
    if (scenario.status !== 'pending' && scenario.status !== 'running') {
      events.push({ type: 'scenario.finished', scenario });
    }
  }
  for (const finding of findings) events.push({ type: 'finding.created', finding });
  events.push({ type: 'score.updated', score });
  if (run.status === 'completed') {
    events.push({ type: 'run.completed', run });
  } else if (run.status === 'failed') {
    events.push({ type: 'run.failed', runId: run.id, error: run.error ?? 'Run failed' });
  }
  return events;
}

/**
 * Serves the frozen REST + SSE contract from the live orchestrator and repositories.
 * Every successful response is validated with its contract schema before it is sent.
 */
export function createApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const { repos, config, bus } = deps;
  const clients = new Set<SseClient>();
  let lastRunId: string | null = null;

  const onEvent = (event: RunEvent) => {
    const knownRunId = eventRunId(event, repos);
    if (knownRunId !== null) lastRunId = knownRunId;
    const runId = event.type === 'score.updated' ? lastRunId : knownRunId;
    if (runId === null) return;
    for (const client of clients) {
      if (client.runId === runId) client.write(event);
    }
  };
  bus.on('event', onEvent);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', outputOrigin(request.headers.origin));
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    if (request.method === 'OPTIONS') reply.code(204).send();
  });

  app.addHook('onClose', async () => {
    bus.off('event', onEvent);
    for (const client of clients) client.response.destroy();
    clients.clear();
  });

  app.setNotFoundHandler((_request, reply) => notFound(reply));

  app.setErrorHandler((error: unknown, _request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;
    return reply
      .code(statusCode)
      .send({ error: error instanceof Error ? error.message : String(error) });
  });

  app.get('/api/health', async (_request, reply) =>
    send(reply, Health, {
      ok: true,
      mode: config.mode,
      version: deps.version ?? '0.0.0',
      aiProvider: config.aiProvider,
    }),
  );

  app.get('/api/scenarios', async (_request, reply) => {
    const scenarios = (Object.keys(SCENARIO_META) as ScenarioKey[]).map((key) => ({
      key,
      title: SCENARIO_META[key].title,
      target: SCENARIO_META[key].target,
      description: SCENARIO_META[key].description,
    }));
    return send(reply, ScenarioInfo.array(), scenarios);
  });

  app.post('/api/runs', async (request, reply) => {
    const parsed = RunCreateRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid run request' });
    const runId = deps.orchestrator.startRun(parsed.data);
    return reply.code(202).send(RunCreateResponse.parse({ runId }));
  });

  app.get('/api/runs', async (_request, reply) => {
    const runs = repos.listRuns().map((run) => {
      const findings = repos.listFindings(run.id);
      return { ...run, findingCount: findings.length, score: computeScore(findings) };
    });
    return send(reply, RunSummary.array(), runs);
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = repos.getRun(id);
    if (!run) return notFound(reply);
    const scenarios = repos.listScenarios(id);
    const findings = repos.listFindings(id);
    return send(reply, RunDetail, { run, scenarios, findings, score: computeScore(findings) });
  });

  app.get('/api/runs/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!repos.getRun(id)) return notFound(reply);
    const { scenarioId } = request.query as { scenarioId?: string };
    return send(reply, StepList, repos.listSteps(id, scenarioId || undefined));
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = repos.getRun(id);
    if (!run) return notFound(reply);

    const scenarios = repos.listScenarios(id);
    const findings = repos.listFindings(id);
    const score = computeScore(findings);
    const replay = historyEvents(scenarios, findings, score, run);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': outputOrigin(request.headers.origin),
    });

    const write = (event: RunEvent) => {
      if (reply.raw.writableEnded) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(RunEvent.parse(event))}\n\n`);
      } catch {
        return;
      }
    };

    for (const event of replay) write(event);

    const client: SseClient = { runId: id, response: reply.raw, write };
    clients.add(client);
    lastRunId = id;

    const keepalive = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(':keepalive\n\n');
    }, 15_000);
    keepalive.unref();

    reply.raw.on('close', () => {
      clearInterval(keepalive);
      clients.delete(client);
    });
  });

  app.get('/api/findings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const finding = repos.getFinding(id);
    if (!finding) return notFound(reply);
    const patch = repos.getPatchForFinding(id);
    return send(reply, FindingDetail, {
      finding,
      steps: repos.listStepsByIds(finding.evidenceStepIds),
      explanation: repos.getExplanation(id),
      patch,
      verify: patch === null ? null : repos.getVerifyForPatch(patch.id),
    });
  });

  app.post('/api/findings/:id/prescribe', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!repos.getFinding(id)) return notFound(reply);
    void deps.orchestrator.prescribe(id).catch((error: unknown) => {
      app.log.error({ err: error }, 'prescribe failed');
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/findings/:id/open-pr', async (request, reply) => {
    const { id } = request.params as { id: string };
    const finding = repos.getFinding(id);
    if (!finding) return notFound(reply);
    if (deps.openPr) return send(reply, OpenPrResponse, await deps.openPr(finding));
    return send(reply, OpenPrResponse, {
      prUrl: null,
      reason: 'GitHub is not configured',
    });
  });

  app.post('/api/runs/:id/protect', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = repos.getRun(id);
    if (!run) return notFound(reply);
    if (run.target !== 'agent') {
      return reply
        .code(409)
        .send({ error: `Run ${id} is not an agent run`, code: 'protect_not_applicable' });
    }
    try {
      await deps.orchestrator.protect(id);
    } catch (error) {
      if (error instanceof ProtectNotApplicableError) {
        return reply.code(409).send({ error: error.message, code: 'protect_not_applicable' });
      }
      if (error instanceof ProtectNotConfiguredError) {
        return reply.code(409).send({ error: error.message, code: 'protect_not_configured' });
      }
      throw error;
    }
    return reply.code(202).send({ accepted: true });
  });

  app.get('/api/runs/:id/policy', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!repos.getRun(id)) return notFound(reply);
    return send(reply, PolicyResponse, repos.getLatestPolicy(id) ?? { policy: null, yaml: null });
  });

  app.get('/api/runs/:id/decisions', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!repos.getRun(id)) return notFound(reply);
    return send(reply, DecisionList, repos.listDecisions(id));
  });

  return app;
}
