import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVER_TIMEOUT_MS,
  PlaywrightApproverError,
  SELECTORS,
  createApprover,
  createPlaywrightApprover,
  type PlaywrightPage,
  type RecordedHttp,
} from '@payclinic/core';

const EMAIL = 'buyer@example.com';
const PASSWORD = 'super-secret-password';
const APPROVE_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=O1';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function recordingPage(calls: string[]): PlaywrightPage {
  return {
    async goto(url, opts) {
      calls.push(`goto:${url}:${opts?.timeout ?? ''}`);
    },
    async fill(selector, value, opts) {
      calls.push(`fill:${selector}:${value}:${opts?.timeout ?? ''}`);
    },
    async click(selector, opts) {
      calls.push(`click:${selector}:${opts?.timeout ?? ''}`);
    },
    async waitForURL(_url, opts) {
      calls.push(`waitForURL:${opts?.timeout ?? ''}`);
    },
    async screenshot(opts) {
      calls.push(`screenshot:${opts.path}`);
    },
    async close() {
      calls.push('close');
    },
  };
}

describe('createPlaywrightApprover', () => {
  it('logs in and approves in order with the 60 s timeout', async () => {
    const calls: string[] = [];
    const page = recordingPage(calls);
    const close = vi.fn(async () => {
      calls.push('session.close');
    });
    const launch = vi.fn(async () => ({ page, close }));

    const approver = createPlaywrightApprover({
      buyerEmail: EMAIL,
      buyerPassword: PASSWORD,
      launch,
    });
    await approver.approve('O1', APPROVE_URL);

    expect(calls).toEqual([
      `goto:${APPROVE_URL}:${APPROVER_TIMEOUT_MS}`,
      `fill:${SELECTORS.email}:${EMAIL}:${APPROVER_TIMEOUT_MS}`,
      `fill:${SELECTORS.password}:${PASSWORD}:${APPROVER_TIMEOUT_MS}`,
      `click:${SELECTORS.login}:${APPROVER_TIMEOUT_MS}`,
      `click:${SELECTORS.approve}:${APPROVER_TIMEOUT_MS}`,
      `waitForURL:${APPROVER_TIMEOUT_MS}`,
      'session.close',
    ]);
    expect(calls).not.toContain('close');
  });

  it('screenshots the failure, closes the session, and names the step without credentials', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'approver-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const screenshot = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const page: PlaywrightPage = {
      ...recordingPage([]),
      async click(selector) {
        if (selector === SELECTORS.approve) {
          throw new Error(`No element ${selector} for ${EMAIL} / ${PASSWORD}`);
        }
      },
      screenshot,
    };

    const approver = createPlaywrightApprover({
      buyerEmail: EMAIL,
      buyerPassword: PASSWORD,
      launch: async () => ({ page, close }),
      failureScreenshotPath: join(dir, 'approver-failure.png'),
    });

    const error = await approver.approve('O1', APPROVE_URL).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlaywrightApproverError);
    expect((error as Error).message).toContain('click approve');
    expect((error as Error).message).not.toContain(EMAIL);
    expect((error as Error).message).not.toContain(PASSWORD);
    expect(screenshot).toHaveBeenCalledWith({
      path: join(dir, 'approver-failure.png'),
      timeout: APPROVER_TIMEOUT_MS,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('selects Playwright from config and requires buyer credentials', () => {
    const http: RecordedHttp = {
      async request() {
        return { status: 200, body: {}, stepId: 's1' };
      },
    };

    expect(() => createApprover({ config: { buyerApprover: 'playwright' }, http })).toThrow(
      /PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD/,
    );
  });
});
