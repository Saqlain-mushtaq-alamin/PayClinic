import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BuyerApprover } from './approvers';

export const APPROVER_TIMEOUT_MS = 60_000;

/** Sandbox buyer-checkout selectors, grouped here so PayPal markup changes stay localized. */
export const SELECTORS = {
  email: 'input[name="login_email"], input[type="email"], #email',
  password: 'input[name="login_password"], input[type="password"], #password',
  login: 'button[type="submit"], #btnLogin, #btnNext',
  approve:
    'button[data-testid="review-and-continue-button"], button[data-testid="confirm-button"], #confirmButtonTop, button[name="continue"]',
} as const;

const RETURN_URL_PATTERN = /^(?!https?:\/\/(?:[^/]+\.)?(?:sandbox\.)?paypal\.com(?:\/|$)).+/i;
const DEFAULT_SCREENSHOT_PATH = join(process.cwd(), 'data', 'approver-failure.png');

export interface PlaywrightPage {
  goto(url: string, opts?: { timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<unknown>;
  screenshot?(opts: { path: string; timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface PlaywrightSession {
  page: PlaywrightPage;
  close?(): Promise<void>;
}

export type LaunchFn = () => Promise<PlaywrightSession>;

/** Raised when an approval step fails; the message names the step and never includes credentials. */
export class PlaywrightApproverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaywrightApproverError';
  }
}

interface BrowserLike {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface ChromiumLike {
  launch(): Promise<BrowserLike>;
}

interface PlaywrightModule {
  chromium?: ChromiumLike;
}

async function defaultLaunch(): Promise<PlaywrightSession> {
  const moduleName = 'playwright';
  let playwright: PlaywrightModule;
  try {
    playwright = (await import(moduleName)) as PlaywrightModule;
  } catch {
    throw new PlaywrightApproverError(
      'launch: Playwright is not installed; set BUYER_APPROVER=manual or install playwright',
    );
  }
  const chromium = playwright.chromium;
  if (!chromium) {
    throw new PlaywrightApproverError('launch: the Playwright chromium export is missing');
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  return { page, close: () => browser.close() };
}

function sanitize(message: string, secrets: string[]): string {
  let output = message;
  for (const secret of secrets) {
    if (secret !== '') output = output.split(secret).join('***');
  }
  return output;
}

async function step<T>(name: string, secrets: string[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PlaywrightApproverError(
      `Playwright approval failed at ${name}: ${sanitize(detail, secrets)}`,
    );
  }
}

async function closeSession(session: PlaywrightSession): Promise<void> {
  if (session.close) {
    await session.close();
    return;
  }
  await session.page.close();
}

async function takeFailureScreenshot(page: PlaywrightPage, path: string): Promise<void> {
  if (!page.screenshot) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, timeout: APPROVER_TIMEOUT_MS });
  } catch {
    // The original step error is the useful failure; the artifact is best-effort.
  }
}

/** Logs into the sandbox buyer account and approves the PayPal order in a browser. */
export function createPlaywrightApprover(o: {
  buyerEmail: string;
  buyerPassword: string;
  launch?: LaunchFn;
  failureScreenshotPath?: string;
}): BuyerApprover {
  const launch = o.launch ?? defaultLaunch;
  const secrets = [o.buyerEmail, o.buyerPassword].filter((value) => value !== '');
  const screenshotPath = o.failureScreenshotPath ?? DEFAULT_SCREENSHOT_PATH;

  return {
    async approve(_orderId: string, approveUrl: string): Promise<void> {
      let session: PlaywrightSession | undefined;
      let failure: unknown;

      try {
        session = await step('launch', secrets, launch);
        const page = session.page;
        await step('open approval URL', secrets, () =>
          page.goto(approveUrl, { timeout: APPROVER_TIMEOUT_MS }),
        );
        await step('fill buyer email', secrets, () =>
          page.fill(SELECTORS.email, o.buyerEmail, { timeout: APPROVER_TIMEOUT_MS }),
        );
        await step('fill buyer password', secrets, () =>
          page.fill(SELECTORS.password, o.buyerPassword, { timeout: APPROVER_TIMEOUT_MS }),
        );
        await step('click login', secrets, () =>
          page.click(SELECTORS.login, { timeout: APPROVER_TIMEOUT_MS }),
        );
        await step('click approve', secrets, () =>
          page.click(SELECTORS.approve, { timeout: APPROVER_TIMEOUT_MS }),
        );
        await step('wait for return URL', secrets, () =>
          page.waitForURL(RETURN_URL_PATTERN, { timeout: APPROVER_TIMEOUT_MS }),
        );
      } catch (error) {
        failure = error;
        if (session) await takeFailureScreenshot(session.page, screenshotPath);
      } finally {
        if (session) {
          try {
            await closeSession(session);
          } catch {
            // A close error must not hide an approval failure or turn an approval into a failure.
          }
        }
      }

      if (failure !== undefined) throw failure;
    },
  };
}
