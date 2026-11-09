import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StepRecorder } from './recorder';

export interface MockRule {
  method: string;
  pathRegex: string;
  mockCode: string;
}

export interface TraceProxy {
  url: string;
  setScenario(ctx: { runId: string; scenarioId: string }): void;
  mockNext(rule: MockRule): void;
  clearMocks(): void;
  stop(): Promise<void>;
}

const proxyMockRules = new Map<string, MockRule[]>();

export function setProxyMockRule(runId: string, rule: MockRule): void {
  const list = proxyMockRules.get(runId) ?? [];
  list.push(rule);
  proxyMockRules.set(runId, list);
}

export function popProxyMockRule(
  runId: string,
  method: string,
  path: string,
): MockRule | undefined {
  const list = proxyMockRules.get(runId);
  if (!list || list.length === 0) return undefined;
  const index = list.findIndex((r) => r.method === method && new RegExp(r.pathRegex).test(path));
  if (index === -1) return undefined;
  const [rule] = list.splice(index, 1);
  return rule;
}

export function clearProxyMockRules(runId: string): void {
  proxyMockRules.delete(runId);
}

function headerRecord(raw: IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseBody(body: Buffer, contentType: string | null): unknown {
  const text = body.toString('utf8');
  if (text.trim() === '') return undefined;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function forwardingHeaders(
  incoming: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  const headers = { ...incoming, ...extra };
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding']) {
    delete headers[name];
  }
  return headers;
}

function responseHeaders(raw: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  raw.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

function outgoingHeaders(recorded: Record<string, string>): Record<string, string> {
  const headers = { ...recorded };
  for (const name of [
    'content-length',
    'content-encoding',
    'transfer-encoding',
    'connection',
    'keep-alive',
  ]) {
    delete headers[name];
  }
  return headers;
}

function splitUrl(raw: string): { pathname: string } {
  return { pathname: new URL(raw, 'http://placeholder').pathname };
}

export interface RecordedExchange {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number;
}

export interface ForwardProxyRequestOptions {
  target: string;
  subpath?: string;
  mockRule?: MockRule;
  body?: unknown;
  onFinish?: (exchange: RecordedExchange) => void;
}

/** Forwards an incoming HTTP request to the target and records the full exchange. */
export async function forwardProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ForwardProxyRequestOptions,
): Promise<{ status: number; exchange: RecordedExchange }> {
  const method = req.method ?? 'GET';
  const rawUrl = opts.subpath ?? req.url ?? '/';
  const target = opts.target.replace(/\/+$/, '');
  const targetUrl = new URL(target);
  const incoming = headerRecord(req.headers);
  const started = Date.now();

  let status = 599;
  let headers: Record<string, string> = {};
  let body: unknown;
  let responseBuffer = Buffer.alloc(0);
  let recordedUrl = `${targetUrl.protocol}//${incoming.host ?? targetUrl.host}${rawUrl}`;
  let forwardedHeaders: Record<string, string> = incoming;
  let requestBody: unknown = undefined;

  try {
    let requestBuffer: Buffer;
    if (opts.body !== undefined) {
      requestBody = opts.body;
      requestBuffer = Buffer.isBuffer(opts.body)
        ? opts.body
        : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    } else {
      requestBuffer = await readBody(req);
      requestBody = parseBody(requestBuffer, incoming['content-type'] ?? null);
    }
    const extra: Record<string, string> = opts.mockRule
      ? {
          'paypal-mock-response': JSON.stringify({
            mock_application_codes: opts.mockRule.mockCode,
          }),
        }
      : {};
    forwardedHeaders = forwardingHeaders(incoming, extra);
    const fetchUrl = `${target}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
    recordedUrl = `${targetUrl.protocol}//${incoming.host ?? targetUrl.host}${rawUrl}`;

    const response = await fetch(fetchUrl, {
      method,
      headers: forwardedHeaders,
      ...(requestBuffer.length > 0 && method !== 'GET' && method !== 'HEAD'
        ? { body: new Uint8Array(requestBuffer) }
        : {}),
    });

    responseBuffer = Buffer.from(await response.arrayBuffer());
    status = response.status;
    headers = responseHeaders(response.headers);
    body = parseBody(responseBuffer, response.headers.get('content-type'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status = 599;
    headers = { 'content-type': 'application/json' };
    body = { name: 'PROXY_ERROR', message };
    responseBuffer = Buffer.from(JSON.stringify(body));
  }

  const exchange: RecordedExchange = {
    method,
    url: recordedUrl,
    requestHeaders: forwardedHeaders,
    requestBody,
    responseStatus: status,
    responseHeaders: headers,
    responseBody: body,
    durationMs: Date.now() - started,
  };

  try {
    opts.onFinish?.(exchange);
  } catch {
    // protect against callback errors
  }

  if (!res.headersSent) {
    res.writeHead(status, outgoingHeaders(headers));
  }
  res.end(responseBuffer);

  return { status, exchange };
}

/** Starts an HTTP trace proxy that records every exchange and can inject mock headers. */
export async function startTraceProxy(o: {
  target: string;
  recorder: StepRecorder;
}): Promise<TraceProxy> {
  const target = o.target.replace(/\/+$/, '');
  const mockRules: MockRule[] = [];
  let stopped = false;

  const consumeMock = (method: string, pathname: string): MockRule | undefined => {
    const index = mockRules.findIndex(
      (rule) =>
        rule.method.toUpperCase() === method.toUpperCase() &&
        new RegExp(rule.pathRegex).test(pathname),
    );
    if (index === -1) return undefined;
    const [rule] = mockRules.splice(index, 1);
    return rule;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const { pathname } = splitUrl(rawUrl);
    const rule = consumeMock(method, pathname);
    const seq = o.recorder.start('store', `${method} ${rawUrl}`);

    await forwardProxyRequest(req, res, {
      target,
      mockRule: rule,
      onFinish: (exchange) => {
        o.recorder.finish(seq, exchange);
      },
    });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          name: 'PROXY_ERROR',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,

    setScenario(ctx: { runId: string; scenarioId: string }): void {
      o.recorder.setScenario(ctx.scenarioId);
    },

    mockNext(rule: MockRule): void {
      mockRules.push({ ...rule });
    },

    clearMocks(): void {
      mockRules.length = 0;
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
