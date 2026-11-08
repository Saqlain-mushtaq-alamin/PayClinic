import type { EventEmitter } from 'node:events';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { z } from 'zod';
import {
  AdapterCheckResponse,
  AuthStatusResponse,
  DecisionList,
  FindingDetail,
  Health,
  OpenPrResponse,
  PolicyResponse,
  Project,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  RunCreateRequest,
  RunCreateResponse,
  RunDetail,
  RunEvent,
  RunSummary,
  SCENARIO_META,
  ScenarioInfo,
  SettingsResponse,
  SettingsUpdateRequest,
  StepList,
  TestKind,
  TestSettingsResponse,
  type Finding,
  type ScenarioKey,
  type ScenarioResult,
  type Score,
  type Step,
} from '@payclinic/contracts';
import {
  ProjectsRepo,
  ProtectNotApplicableError,
  ProtectNotConfiguredError,
  SettingsStore,
  adapterCheck,
  assertSafeTarget,
  computeScore,
  createProjectsRepo,
  encrypt,
  forwardProxyRequest,
  openDb,
  popProxyMockRule,
  type Config,
  type Orchestrator,
  type Repos,
} from '@payclinic/core';
import { startSim } from '@payclinic/sim';
import {
  defaultTestGemini,
  defaultTestGitHub,
  defaultTestPayPal,
} from './test-settings';

const ALLOWED_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DEFAULT_ORIGIN = 'http://localhost:5173';

export type OpenPr = (finding: Finding) => Promise<z.infer<typeof OpenPrResponse>>;

export interface ApiDeps {
  orchestrator: Orchestrator;
  repos: Repos;
  projectsRepo?: ProjectsRepo;
  config: Config;
  bus: EventEmitter;
  version?: string;
  openPr?: OpenPr;
  /** Directory of the built dashboard; enables static hosting with SPA fallback. */
  staticDir?: string;
  settingsStore?: SettingsStore;
  getConfig?: () => Config;
  testers?: {
    paypal?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
    gemini?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
    github?: (store: SettingsStore) => Promise<{ ok: boolean; message: string }>;
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves a file from the static directory, falling back to index.html for
 * extension-less client routes. Returns false when nothing could be served.
 */
function serveStatic(staticDir: string, url: string, reply: FastifyReply): boolean {
  const pathOnly = url.split('?')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return false;
  }
  const candidate = resolve(staticDir, normalize(decoded).replace(/^([/\\])+/, ''));
  if (candidate !== staticDir && !candidate.startsWith(staticDir + sep)) return false;

  let filePath = candidate;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(decoded) !== '') return false;
    filePath = join(staticDir, 'index.html');
    if (!existsSync(filePath)) return false;
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  void reply.header('content-type', type).send(createReadStream(filePath));
  return true;
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
  return origin !== undefined && ALLOWED_ORIGIN_PATTERN.test(origin) ? origin : DEFAULT_ORIGIN;
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
  const settingsStore = deps.settingsStore ?? new SettingsStore(openDb(':memory:'));
  const projectsRepo = deps.projectsRepo ?? createProjectsRepo(openDb(':memory:'));
  const clients = new Set<SseClient>();
  let lastRunId: string | null = null;
  let activeSim: Awaited<ReturnType<typeof startSim>> | null = null;
  const getSimUrl = async (): Promise<string> => {
    if (deps.orchestrator.getSimUrl) {
      return deps.orchestrator.getSimUrl();
    }
    if (!activeSim) {
      activeSim = await startSim();
    }
    return activeSim.url;
  };

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
    reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization');
    if (request.method === 'OPTIONS') reply.code(204).send();
  });

  app.addHook('preHandler', async (request, reply) => {
    const adminToken = process.env.PAYCLINIC_ADMIN_TOKEN;
    if (!adminToken) return;

    const url = request.url.split('?')[0] ?? '';
    const isSettings = url.startsWith('/api/settings');
    const isProjectWrite = url.startsWith('/api/projects') && request.method !== 'GET';
    if (isSettings || isProjectWrite) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'unauthorized: missing or invalid Bearer token' });
      }
      const token = authHeader.slice(7).trim();
      const tokenBuf = Buffer.from(token, 'utf8');
      const expectedBuf = Buffer.from(adminToken, 'utf8');
      if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
        return reply.code(401).send({ error: 'unauthorized: invalid admin token' });
      }
    }
  });

  app.addHook('onClose', async () => {
    bus.off('event', onEvent);
    for (const client of clients) client.response.destroy();
    clients.clear();
    if (activeSim) {
      await activeSim.close().catch(() => undefined);
      activeSim = null;
    }
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      deps.staticDir !== undefined &&
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      !request.url.startsWith('/paypal-proxy')
    ) {
      if (!serveStatic(deps.staticDir, request.url, reply)) notFound(reply);
      return;
    }
    notFound(reply);
  });

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
    const projectId = parsed.data.projectId ?? 'builtin';
    const project = projectsRepo.getProject(projectId);
    if (!project) {
      return reply.code(400).send({ error: `project '${projectId}' does not exist` });
    }
    try {
      const runId = deps.orchestrator.startRun(parsed.data);
      return reply.code(202).send(RunCreateResponse.parse({ runId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.get('/api/runs', async (_request, reply) => {
    const projects = new Map(projectsRepo.listProjects().map((p) => [p.id, p.name]));
    const runs = repos.listRuns().map((run) => {
      const findings = repos.listFindings(run.id);
      const projectName = run.projectId
        ? projects.get(run.projectId) ?? (run.projectId === 'builtin' ? 'Demo store' : run.projectId)
        : 'Demo store';
      return { ...run, projectName, findingCount: findings.length, score: computeScore(findings) };
    });
    return send(reply, RunSummary.array(), runs);
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = repos.getRun(id);
    if (!run) return notFound(reply);
    const projects = new Map(projectsRepo.listProjects().map((p) => [p.id, p.name]));
    const projectName = run.projectId
      ? projects.get(run.projectId) ?? (run.projectId === 'builtin' ? 'Demo store' : run.projectId)
      : 'Demo store';
    const runWithProjectName = { ...run, projectName };
    const scenarios = repos.listScenarios(id);
    const findings = repos.listFindings(id);
    return send(reply, RunDetail, {
      run: runWithProjectName,
      scenarios,
      findings,
      score: computeScore(findings),
    });
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

  app.get('/api/auth/status', async (_request, reply) =>
    send(reply, AuthStatusResponse, {
      required: Boolean(process.env.PAYCLINIC_ADMIN_TOKEN),
    }),
  );

  app.get('/api/settings', async (_request, reply) =>
    send(reply, SettingsResponse, settingsStore.masked()),
  );

  app.put('/api/settings', async (request, reply) => {
    const parsed = SettingsUpdateRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid settings update body' });
    const updates = parsed.data;

    if (updates['mode'] === 'online') {
      const hasVerified = Boolean(
        settingsStore.get('paypalVerifiedAt') || updates['paypalVerifiedAt'],
      );
      if (!hasVerified) {
        return reply
          .code(400)
          .send({ error: "Cannot set mode to 'online' without verified PayPal credentials" });
      }
    }

    for (const [key, val] of Object.entries(updates)) {
      if (val === '') continue;
      if (val === null) {
        settingsStore.delete(key);
        continue;
      }
      try {
        settingsStore.set(key, val);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return send(reply, SettingsResponse, settingsStore.masked());
  });

  app.post('/api/settings/test/:kind', async (request, reply) => {
    const { kind } = request.params as { kind: string };
    const parsedKind = TestKind.safeParse(kind);
    if (!parsedKind.success) {
      return reply.code(400).send({ error: `Invalid test kind: ${kind}` });
    }

    let result: { ok: boolean; message: string };
    switch (parsedKind.data) {
      case 'paypal':
        result = deps.testers?.paypal
          ? await deps.testers.paypal(settingsStore)
          : await defaultTestPayPal(settingsStore);
        break;
      case 'gemini':
        result = deps.testers?.gemini
          ? await deps.testers.gemini(settingsStore)
          : await defaultTestGemini(settingsStore);
        break;
      case 'github':
        result = deps.testers?.github
          ? await deps.testers.github(settingsStore)
          : await defaultTestGitHub(settingsStore);
        break;
    }

    return send(reply, TestSettingsResponse, result);
  });

  app.get('/api/projects', async (request, reply) => {
    const publicUrl = settingsStore.get('publicUrl');
    const base = publicUrl || `${request.protocol}://${request.headers.host ?? 'localhost:4000'}`;
    const list = projectsRepo.listProjects().map((p) =>
      Project.parse({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        proxyToken: p.proxyToken,
        proxyUrl: `${base.replace(/\/+$/, '')}/paypal-proxy/${p.proxyToken}`,
        hasAdminSecret: Boolean(p.adminSecretEncrypted),
        repoOwner: p.repoOwner,
        repoName: p.repoName,
        repoBranch: p.repoBranch,
        sourceRoot: p.sourceRoot,
        createdAt: p.createdAt,
      }),
    );
    return send(reply, Project.array(), list);
  });

  app.post('/api/projects', async (request, reply) => {
    const parsed = ProjectCreateRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid project request' });
    const { name, baseUrl, adminSecret, repoOwner, repoName, repoBranch, sourceRoot } =
      parsed.data;

    if (baseUrl) {
      try {
        await assertSafeTarget(baseUrl);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    const id = randomUUID();
    const proxyToken = randomUUID().replace(/-/g, '');
    const adminSecretEncrypted = adminSecret ? encrypt(adminSecret) : null;
    const createdAt = new Date().toISOString();

    projectsRepo.insertProject({
      id,
      name,
      kind: 'remote',
      baseUrl: baseUrl ?? null,
      adminSecretEncrypted,
      proxyToken,
      repoOwner: repoOwner ?? null,
      repoName: repoName ?? null,
      repoBranch: repoBranch ?? null,
      sourceRoot: sourceRoot ?? null,
      createdAt,
    });

    const publicUrl = settingsStore.get('publicUrl');
    const base = publicUrl || `${request.protocol}://${request.headers.host ?? 'localhost:4000'}`;
    const created = Project.parse({
      id,
      name,
      kind: 'remote',
      baseUrl: baseUrl ?? null,
      proxyToken,
      proxyUrl: `${base.replace(/\/+$/, '')}/paypal-proxy/${proxyToken}`,
      hasAdminSecret: Boolean(adminSecretEncrypted),
      repoOwner: repoOwner ?? null,
      repoName: repoName ?? null,
      repoBranch: repoBranch ?? null,
      sourceRoot: sourceRoot ?? null,
      createdAt,
    });

    return reply.code(201).send(created);
  });

  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = projectsRepo.getProject(id);
    if (!existing) return notFound(reply);

    if (existing.id === 'builtin' || existing.kind === 'builtin') {
      return reply.code(403).send({ error: 'Cannot edit builtin project' });
    }

    const parsed = ProjectUpdateRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid project update' });
    const { name, baseUrl, adminSecret, repoOwner, repoName, repoBranch, sourceRoot } =
      parsed.data;

    if (baseUrl) {
      try {
        await assertSafeTarget(baseUrl);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    let adminSecretEncrypted: string | null | undefined = undefined;
    if (adminSecret === null) {
      adminSecretEncrypted = null;
    } else if (typeof adminSecret === 'string' && adminSecret !== '') {
      adminSecretEncrypted = encrypt(adminSecret);
    }

    projectsRepo.updateProject(id, {
      name,
      baseUrl,
      adminSecretEncrypted,
      repoOwner,
      repoName,
      repoBranch,
      sourceRoot,
    });

    const updated = projectsRepo.getProject(id)!;
    const publicUrl = settingsStore.get('publicUrl');
    const base = publicUrl || `${request.protocol}://${request.headers.host ?? 'localhost:4000'}`;

    return send(reply, Project, {
      id: updated.id,
      name: updated.name,
      kind: updated.kind,
      baseUrl: updated.baseUrl,
      proxyToken: updated.proxyToken,
      proxyUrl: `${base.replace(/\/+$/, '')}/paypal-proxy/${updated.proxyToken}`,
      hasAdminSecret: Boolean(updated.adminSecretEncrypted),
      repoOwner: updated.repoOwner,
      repoName: updated.repoName,
      repoBranch: updated.repoBranch,
      sourceRoot: updated.sourceRoot,
      createdAt: updated.createdAt,
    });
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = projectsRepo.getProject(id);
    if (!existing) return notFound(reply);

    if (existing.id === 'builtin' || existing.kind === 'builtin') {
      return reply.code(403).send({ error: 'Cannot delete builtin project' });
    }

    projectsRepo.deleteProject(id);
    return reply.code(200).send({ ok: true });
  });

  app.post('/api/projects/:id/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectsRepo.getProject(id);
    if (!project) return notFound(reply);

    const checklist = await adapterCheck(project);
    return send(reply, AdapterCheckResponse, checklist);
  });

  app.get('/api/docs/connect-your-site', async (_request, reply) => {
    const docPath = resolve(process.cwd(), 'docs/CONNECT-YOUR-SITE.md');
    if (!existsSync(docPath)) {
      return reply.code(404).send({ error: 'Documentation not found' });
    }
    const content = createReadStream(docPath);
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', 'attachment; filename="CONNECT-YOUR-SITE.md"')
      .send(content);
  });

  const handlePaypalProxy = async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };
    const project = projectsRepo.getProjectByProxyToken(token);
    if (!project) {
      return reply.code(404).send({ error: 'Unknown proxy token' });
    }

    const runs = repos.listRuns();
    const activeRun = runs.find(
      (r) =>
        r.status === 'running' &&
        (r.projectId === project.id || (project.id === 'builtin' && (!r.projectId || r.projectId === 'builtin'))),
    );

    if (!activeRun) {
      return reply.code(409).send({ error: 'No PayClinic run active' });
    }

    let target = 'https://api-m.sandbox.paypal.com';
    if (activeRun.mode === 'offline') {
      target = await getSimUrl();
    }

    const prefix = `/paypal-proxy/${token}`;
    const rawUrl = request.url;
    let subpath = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : rawUrl;
    if (!subpath.startsWith('/')) subpath = '/' + subpath;

    reply.hijack();

    const mockRule = popProxyMockRule(activeRun.id, request.method, subpath);

    await forwardProxyRequest(request.raw, reply.raw, {
      target,
      subpath,
      mockRule,
      body: request.body,
      onFinish: (exchange) => {
        const scenarios = repos.listScenarios(activeRun.id);
        const scenarioId = scenarios[scenarios.length - 1]?.id ?? `${activeRun.id}-scenario-1`;
        const steps = repos.listSteps(activeRun.id);
        const step: Step = {
          id: randomUUID(),
          runId: activeRun.id,
          scenarioId,
          seq: steps.length,
          actor: 'store',
          label: `${exchange.method} ${subpath}`,
          url: exchange.url,
          method: exchange.method,
          requestHeaders: exchange.requestHeaders,
          requestBody: exchange.requestBody,
          responseStatus: exchange.responseStatus,
          responseHeaders: exchange.responseHeaders,
          responseBody: exchange.responseBody,
          durationMs: exchange.durationMs,
          timestamp: new Date().toISOString(),
        };
        repos.insertSteps([step]);
        bus.emit('event', { type: 'step.recorded', step });
      },
    });
  };

  app.all('/paypal-proxy/:token/*', handlePaypalProxy);
  app.all('/paypal-proxy/:token', handlePaypalProxy);

  return app;
}
