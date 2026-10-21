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

/** Starts an HTTP trace proxy that records every exchange and can inject mock headers. */
export async function startTraceProxy(o: {
  target: string;
  recorder: StepRecorder;
}): Promise<TraceProxy> {
  const target = o.target.replace(/\/+$/, '');
  const targetUrl = new URL(target);
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
    const incoming = headerRecord(req.headers);
    const { pathname } = splitUrl(rawUrl);
    const started = Date.now();
    const seq = o.recorder.start('store', `${method} ${rawUrl}`);

    let status = 599;
    let headers: Record<string, string> = {};
    let body: unknown;
    let responseBuffer = Buffer.alloc(0);
    let recordedUrl = `${targetUrl.protocol}//${incoming.host ?? targetUrl.host}${rawUrl}`;

    try {
      const requestBuffer = await readBody(req);
      const requestBody = parseBody(requestBuffer, incoming['content-type'] ?? null);
      const rule = consumeMock(method, pathname);
      const extra: Record<string, string> = rule
        ? { 'paypal-mock-response': JSON.stringify({ mock_application_codes: rule.mockCode }) }
        : {};
      const forwardedHeaders = forwardingHeaders(incoming, extra);
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

      o.recorder.finish(seq, {
        method,
        url: recordedUrl,
        requestHeaders: forwardedHeaders,
        requestBody,
        responseStatus: status,
        responseHeaders: headers,
        responseBody: body,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = 599;
      headers = { 'content-type': 'application/json' };
      body = { name: 'PROXY_ERROR', message };
      responseBuffer = Buffer.from(JSON.stringify(body));

      o.recorder.finish(seq, {
        method,
        url: recordedUrl,
        requestHeaders: incoming,
        requestBody: undefined,
        responseStatus: status,
        responseHeaders: headers,
        responseBody: body,
        durationMs: Date.now() - started,
      });
    }

    res.writeHead(status, outgoingHeaders(headers));
    res.end(responseBuffer);
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
