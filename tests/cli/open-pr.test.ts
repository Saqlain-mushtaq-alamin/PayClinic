import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Explanation, Finding, Patch, VerifyResult } from '@payclinic/contracts';
import { createRepos, openDb, type Repos } from '@payclinic/core';
import {
  PrNotAllowedError,
  createOpenPr,
  openPrFromEnv,
  type GitHubLike,
} from '../../packages/cli/src/open-pr';

const T = '2026-10-18T10:00:00.000Z';
const FILE = 'apps/buggy-store/src/routes/orders.ts';
const BASE_CONTENT = 'const CAPTURE_LIMIT = 1;\nexport function handleCapture() {}\n';
const EDITED_CONTENT = 'const CAPTURE_LIMIT = 5;\nexport function handleCapture() {}\n';
const TOKEN = 'secret-token-123';

class FakeGitHub implements GitHubLike {
  calls: string[] = [];
  refs = new Map<string, string>();
  files = new Map<string, string>();
  committed: Array<{ path: string; branch: string; message: string; content: string }> = [];
  pullRequest: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  } | null = null;
  failCreatePullRequest: Error | null = null;
  prUrl = 'https://github.com/demo/payclinic-demo/pull/7';

  async getRef(params: { ref: string }): Promise<{ data: { object: { sha: string } } }> {
    this.calls.push(`getRef:${params.ref}`);
    const sha = this.refs.get(params.ref);
    if (sha === undefined) throw new Error(`no ref ${params.ref}`);
    return { data: { object: { sha } } };
  }

  async createRef(params: { ref: string; sha: string }): Promise<{ data: unknown }> {
    this.calls.push(`createRef:${params.ref}`);
    this.refs.set(params.ref, params.sha);
    return { data: {} };
  }

  async getContent(params: { path: string; ref: string }): Promise<{
    data: { content: string; encoding: string; type: string };
  }> {
    this.calls.push(`getContent:${params.ref}:${params.path}`);
    const content = this.files.get(params.path);
    if (content === undefined) throw new Error(`no content for ${params.path}`);
    return {
      data: {
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
        type: 'file',
      },
    };
  }

  async createOrUpdateFileContents(params: {
    path: string;
    branch: string;
    message: string;
    content: string;
  }): Promise<{ data: unknown }> {
    this.calls.push(`commit:${params.branch}:${params.path}`);
    this.committed.push(params);
    return { data: {} };
  }

  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ data: { html_url: string } }> {
    this.calls.push('createPullRequest');
    if (this.failCreatePullRequest) throw this.failCreatePullRequest;
    this.pullRequest = params;
    return { data: { html_url: this.prUrl } };
  }
}

interface Seeded {
  repos: Repos;
  github: FakeGitHub;
  openPr: (findingId: string) => Promise<{ prUrl: string }>;
}

function seed(findingOverrides: Partial<Finding> = {}): Seeded {
  const repos = createRepos(openDb(':memory:'));
  repos.insertRun({
    id: 'run-1',
    target: 'store',
    mode: 'offline',
    scenarioKeys: ['B1'],
    status: 'completed',
    startedAt: T,
  });
  const finding: Finding = {
    id: 'fnd-1',
    runId: 'run-1',
    scenarioKey: 'B1',
    invariantKey: 'I-01',
    severity: 'critical',
    state: 'verified',
    title: 'Customer charged twice for one cart',
    summary: 'Cart cart-1 was captured 2 times.',
    evidenceStepIds: [],
    createdAt: T,
    ...findingOverrides,
  };
  repos.insertFinding(finding);
  const patch: Patch = {
    id: 'pat-1',
    findingId: 'fnd-1',
    edits: [
      { file: FILE, search: 'const CAPTURE_LIMIT = 1;', replace: 'const CAPTURE_LIMIT = 5;' },
    ],
    diff: 'diff --git a/apps/buggy-store/src/routes/orders.ts b/apps/buggy-store/src/routes/orders.ts',
    source: 'template',
    createdAt: T,
  };
  repos.insertPatch(patch);
  const explanation: Explanation = {
    findingId: 'fnd-1',
    rootCause: 'The capture route has no idempotency guard.',
    impact: 'Customers are charged twice for one cart.',
    whereInCode: { file: FILE, hint: 'capture handler' },
    fixSummary: 'Guard captures so one cart can only be captured once.',
    model: 'fixture',
    createdAt: T,
  };
  repos.upsertExplanation(explanation);
  const verify: VerifyResult = {
    patchId: 'pat-1',
    applied: true,
    started: true,
    invariantPassed: true,
    testsPassed: true,
    verified: true,
    durationMs: 1200,
    log: [],
    rerunStepIds: [],
  };
  repos.upsertVerify('run-1', verify);

  const github = new FakeGitHub();
  github.refs.set('heads/main', 'abc1234567');
  github.files.set(FILE, BASE_CONTENT);
  const openPr = createOpenPr({
    github,
    repos,
    owner: 'demo',
    repo: 'payclinic-demo',
    baseBranch: 'main',
    now: () => new Date('2026-11-06T10:00:00Z'),
    token: TOKEN,
  });
  return { repos, github, openPr };
}

const expectedBranch = `payclinic/fix-B1-${createHash('sha256').update('fnd-1').digest('hex').slice(0, 7)}`;

describe('createOpenPr', () => {
  it('creates a branch from base, commits the edited content and opens the PR', async () => {
    const { github, openPr } = seed();

    const result = await openPr('fnd-1');

    expect(result.prUrl).toBe(github.prUrl);
    expect(github.calls).toContain(`createRef:refs/heads/${expectedBranch}`);
    expect(github.committed).toEqual([
      {
        owner: 'demo',
        repo: 'payclinic-demo',
        path: FILE,
        branch: expectedBranch,
        message: 'fix(B1): Customer charged twice for one cart',
        content: Buffer.from(EDITED_CONTENT, 'utf8').toString('base64'),
      },
    ]);
    expect(github.pullRequest).not.toBeNull();
    expect(github.pullRequest?.title).toBe('fix(B1): Customer charged twice for one cart');
    expect(github.pullRequest?.head).toBe(expectedBranch);
    expect(github.pullRequest?.base).toBe('main');
    expect(github.pullRequest?.body).toContain('The capture route has no idempotency guard.');
    expect(github.pullRequest?.body).toContain('```diff');
    expect(github.pullRequest?.body).toContain('verified');
    expect(github.pullRequest?.body).toContain('sandbox');
  });

  it('refuses a finding that is not verified and creates nothing', async () => {
    const { github, openPr } = seed({ state: 'open' });

    await expect(openPr('fnd-1')).rejects.toBeInstanceOf(PrNotAllowedError);
    expect(github.calls).toEqual([]);
  });

  it('refuses when there is no patch and creates nothing', async () => {
    const seeded = seed();
    // a finding without a patch: remove it by using a fresh repos without insertPatch
    const repos = createRepos(openDb(':memory:'));
    repos.insertRun({
      id: 'run-1',
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B1'],
      status: 'completed',
      startedAt: T,
    });
    repos.insertFinding({
      id: 'fnd-1',
      runId: 'run-1',
      scenarioKey: 'B1',
      invariantKey: 'I-01',
      severity: 'critical',
      state: 'verified',
      title: 'Customer charged twice for one cart',
      summary: 'Cart cart-1 was captured 2 times.',
      evidenceStepIds: [],
      createdAt: T,
    });
    const openPr = createOpenPr({
      github: seeded.github,
      repos,
      owner: 'demo',
      repo: 'payclinic-demo',
      baseBranch: 'main',
      now: () => new Date('2026-11-06T10:00:00Z'),
      token: TOKEN,
    });

    await expect(openPr('fnd-1')).rejects.toBeInstanceOf(PrNotAllowedError);
    expect(seeded.github.calls).toEqual([]);
  });

  it('fails clearly when a search is not found in the base content and creates nothing', async () => {
    const { github, openPr } = seed();
    github.files.set(FILE, 'export function handleCapture() {}\n');

    await expect(openPr('fnd-1')).rejects.toThrow(/exactly once \(found 0\)/);
    expect(github.calls.some((call) => call.startsWith('createRef'))).toBe(false);
    expect(github.calls.some((call) => call.startsWith('commit'))).toBe(false);
    expect(github.pullRequest).toBeNull();
  });

  it('never leaks the token in returned objects or thrown messages', async () => {
    const { github, openPr } = seed();
    github.failCreatePullRequest = new Error(`Bad credentials for ${TOKEN}`);

    await expect(openPr('fnd-1')).rejects.toThrow(/\[redacted\]/);
    const error = await openPr('fnd-1').catch((reason: unknown) => reason);
    expect(error instanceof Error && error.message.includes(TOKEN)).toBe(false);

    const { openPr: happy } = seed();
    const result = await happy('fnd-1');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe('openPrFromEnv', () => {
  it('returns undefined when GitHub is not configured', () => {
    const repos = createRepos(openDb(':memory:'));
    expect(openPrFromEnv({}, { repos })).toBeUndefined();
    expect(openPrFromEnv({ GITHUB_TOKEN: TOKEN }, { repos })).toBeUndefined();
    expect(
      openPrFromEnv({ GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'not-a-repo' }, { repos }),
    ).toBeUndefined();
  });

  it('returns an open-pr function when configured', () => {
    const repos = createRepos(openDb(':memory:'));
    const openPr = openPrFromEnv(
      { GITHUB_TOKEN: TOKEN, GITHUB_REPO: 'demo/payclinic-demo', GITHUB_BASE_BRANCH: 'trunk' },
      { repos },
    );
    expect(openPr).toBeTypeOf('function');
  });
});
