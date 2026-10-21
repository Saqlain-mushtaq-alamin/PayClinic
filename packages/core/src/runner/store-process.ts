import { spawn } from 'node:child_process';

export interface RunningStore {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export interface StartStoreOptions {
  sourceDir: string;
  paypalBaseUrl: string;
  paypalClientId?: string;
  paypalClientSecret?: string;
  dbPath?: string;
}

const LISTENING_LINE = /^PAYCLINIC_STORE_LISTENING (\d+)$/;
const START_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 2_000;

/** Starts the buggy store as a child process connected to the given PayPal base URL. */
export async function startStore(o: StartStoreOptions): Promise<RunningStore> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    PORT: '0',
    PAYPAL_BASE_URL: o.paypalBaseUrl,
    PAYPAL_CLIENT_ID: o.paypalClientId ?? 'id',
    PAYPAL_CLIENT_SECRET: o.paypalClientSecret ?? 'secret',
    STORE_DB_PATH: o.dbPath ?? ':memory:',
    STORE_ADMIN: '1',
  };

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: o.sourceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let exited = false;
  let stopPromise: Promise<void> | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
  });

  const terminate = async (): Promise<void> => {
    if (exited) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    timer.unref();
    try {
      await exitPromise;
    } finally {
      clearTimeout(timer);
    }
  };

  const stop = (): Promise<void> => {
    stopPromise ??= terminate();
    return stopPromise;
  };

  return new Promise<RunningStore>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const stderrLines: string[] = [];

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void stop().then(
        () => reject(error),
        () => reject(error),
      );
    };

    const timeout = setTimeout(() => {
      fail(
        new Error(`Store did not print PAYCLINIC_STORE_LISTENING within ${START_TIMEOUT_MS} ms`),
      );
    }, START_TIMEOUT_MS);
    timeout.unref();

    child.once('error', (error) => {
      exited = true;
      fail(new Error(`Store process exited before listening: ${error.message}`));
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      const detail = stderrLines.join('\n');
      fail(
        new Error(
          `Store process exited before listening (code ${String(code)}, signal ${String(signal)})` +
            (detail === '' ? '' : `: ${detail}`),
        ),
      );
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (settled) return;
        const match = LISTENING_LINE.exec(line.trim());
        if (!match) continue;
        const port = Number(match[1]);
        settled = true;
        clearTimeout(timeout);
        resolve({ url: `http://127.0.0.1:${port}`, port, stop });
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') continue;
        stderrLines.push(line);
        if (stderrLines.length > 20) stderrLines.shift();
      }
    });
  });
}
