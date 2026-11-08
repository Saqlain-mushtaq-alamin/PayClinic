import { describe, expect, it } from 'vitest';
import type { Finding } from '@payclinic/contracts';
import {
  fetchProjectSources,
  prescribe,
  type GitHubSourcesClient,
  type PrescribeDeps,
} from '@payclinic/ai';
import { checkEditsSafety, applyEditsToDir } from '@payclinic/core';

const sampleFinding: Finding = {
  id: 'fnd-test-1',
  runId: 'run-1',
  scenarioKey: 'B1',
  invariantKey: 'I-01',
  severity: 'high',
  title: 'Duplicate Orders Created',
  summary: 'Two PayPal orders were created for one checkout',
  evidenceStepIds: ['s1'],
  state: 'open',
  createdAt: '2026-10-18T10:00:00.000Z',
};

describe('Phase 7: Source Picker (fetchProjectSources)', () => {
  it('caps file count at 8 files even when more files match keywords', async () => {
    const mockTree = Array.from({ length: 15 }, (_, i) => ({
      path: `src/orders-service-${i}.ts`,
      type: 'blob',
      size: 500,
    }));

    const mockClient: GitHubSourcesClient = {
      getTree: async () => ({ data: { tree: mockTree } }),
      getContent: async ({ path }) => ({
        data: {
          content: Buffer.from(`// Content of ${path} with orders keyword`).toString('base64'),
          encoding: 'base64',
        },
      }),
    };

    const project = {
      repo_owner: 'acme',
      repo_name: 'shop',
      repo_branch: 'main',
      source_root: 'src',
    };

    const sources = await fetchProjectSources(project, sampleFinding, {
      githubClient: mockClient,
    });

    expect(sources.size).toBe(8);
  });

  it('caps total size at 60 KB', async () => {
    // 5 files, each 20 KB (total 100 KB) -> should stop after 3 files (60 KB)
    const largeContent = 'a'.repeat(20 * 1024);
    const mockTree = Array.from({ length: 5 }, (_, i) => ({
      path: `src/pricing-calc-${i}.ts`,
      type: 'blob',
      size: 20 * 1024,
    }));

    const mockClient: GitHubSourcesClient = {
      getTree: async () => ({ data: { tree: mockTree } }),
      getContent: async () => ({
        data: {
          content: Buffer.from(largeContent).toString('base64'),
          encoding: 'base64',
        },
      }),
    };

    const project = {
      repo_owner: 'acme',
      repo_name: 'shop',
      repo_branch: 'main',
      source_root: 'src',
    };

    const sources = await fetchProjectSources(project, sampleFinding, {
      githubClient: mockClient,
    });

    let totalBytes = 0;
    for (const content of sources.values()) {
      totalBytes += Buffer.byteLength(content, 'utf8');
    }

    expect(totalBytes).toBeLessThanOrEqual(60 * 1024);
    expect(sources.size).toBe(3);
  });

  it('skips node_modules, dist, and lock files', async () => {
    const mockTree = [
      { path: 'src/orders.ts', type: 'blob', size: 100 },
      { path: 'node_modules/orders-lib/index.js', type: 'blob', size: 100 },
      { path: 'dist/orders.js', type: 'blob', size: 100 },
      { path: 'package-lock.json', type: 'blob', size: 100 },
      { path: 'pnpm-lock.yaml', type: 'blob', size: 100 },
      { path: 'yarn.lock', type: 'blob', size: 100 },
      { path: 'bun.lockb', type: 'blob', size: 100 },
    ];

    const mockClient: GitHubSourcesClient = {
      getTree: async () => ({ data: { tree: mockTree } }),
      getContent: async ({ path }) => ({
        data: {
          content: Buffer.from(`// valid orders content for ${path}`).toString('base64'),
          encoding: 'base64',
        },
      }),
    };

    const project = {
      repo_owner: 'acme',
      repo_name: 'shop',
      repo_branch: 'main',
    };

    const sources = await fetchProjectSources(project, sampleFinding, {
      githubClient: mockClient,
    });

    expect(sources.has('src/orders.ts')).toBe(true);
    expect(sources.has('node_modules/orders-lib/index.js')).toBe(false);
    expect(sources.has('dist/orders.js')).toBe(false);
    expect(sources.has('package-lock.json')).toBe(false);
    expect(sources.has('pnpm-lock.yaml')).toBe(false);
    expect(sources.has('yarn.lock')).toBe(false);
    expect(sources.has('bun.lockb')).toBe(false);
  });

  it('filters files to stay under source_root', async () => {
    const mockTree = [
      { path: 'apps/store/src/orders.ts', type: 'blob', size: 100 },
      { path: 'apps/other/src/orders.ts', type: 'blob', size: 100 },
      { path: 'root-orders.ts', type: 'blob', size: 100 },
    ];

    const mockClient: GitHubSourcesClient = {
      getTree: async () => ({ data: { tree: mockTree } }),
      getContent: async ({ path }) => ({
        data: {
          content: Buffer.from(`// orders content for ${path}`).toString('base64'),
          encoding: 'base64',
        },
      }),
    };

    const project = {
      repo_owner: 'acme',
      repo_name: 'shop',
      repo_branch: 'main',
      source_root: 'apps/store',
    };

    const sources = await fetchProjectSources(project, sampleFinding, {
      githubClient: mockClient,
    });

    expect(sources.has('apps/store/src/orders.ts')).toBe(true);
    expect(sources.has('apps/other/src/orders.ts')).toBe(false);
    expect(sources.has('root-orders.ts')).toBe(false);
  });
});

describe('Phase 7: Edits Safety (checkEditsSafety & applyEditsToDir)', () => {
  it('rejects ../ path traversal in file paths', () => {
    const edits = [
      {
        file: 'src/../etc/passwd',
        search: 'old',
        replace: 'new',
      },
    ];

    const safety = checkEditsSafety(edits, { allowedPrefix: 'src/' });
    expect(safety.ok).toBe(false);
    expect(safety.ok === false ? safety.reason : '').toContain('unsafe path');

    const applyResult = applyEditsToDir('.', edits, { allowedPrefix: 'src/' });
    expect(applyResult.ok).toBe(false);
    expect(applyResult.ok === false ? applyResult.reason : '').toContain('unsafe path');
  });

  it('rejects files outside source_root / allowedPrefix', () => {
    const edits = [
      {
        file: 'package.json',
        search: 'old',
        replace: 'new',
      },
    ];

    const safety = checkEditsSafety(edits, { allowedPrefix: 'src/' });
    expect(safety.ok).toBe(false);
    expect(safety.ok === false ? safety.reason : '').toContain('unsafe path');

    const applyResult = applyEditsToDir('.', edits, { allowedPrefix: 'src/' });
    expect(applyResult.ok).toBe(false);
    expect(applyResult.ok === false ? applyResult.reason : '').toContain('unsafe path');
  });

  it('accepts files strictly within allowedPrefix', () => {
    const edits = [
      {
        file: 'src/routes/orders.ts',
        search: 'old',
        replace: 'new',
      },
    ];

    const safety = checkEditsSafety(edits, { allowedPrefix: 'src/' });
    expect(safety.ok).toBe(true);
  });
});

describe('Phase 7: Remote Prescribe without Gemini', () => {
  it('remote prescribe without Gemini returns the configure message', async () => {
    const deps: PrescribeDeps = {
      provider: {
        name: 'gemini',
        generateJSON: async () => {
          throw new Error('should not be called');
        },
      },
      readSource: () => 'content',
      loadReferencePatch: () => null,
      deriveDiff: () => 'diff',
      newId: () => 'p1',
      now: () => '2026-10-18T10:00:00.000Z',
      isRemote: true,
      geminiConfigured: false,
    };

    const result = await prescribe(deps, sampleFinding, []);

    expect(result.explanation.rootCause).toContain('Configure Gemini in Settings to get an AI fix');
    expect(result.explanation.fixSummary).toContain('Configure Gemini in Settings to get an AI fix');
    expect(result.patches).toEqual([]);
    expect(result.message).toContain('Configure Gemini in Settings to get an AI fix');
  });

  it('builtin prescribe with Gemini selected but not configured throws clear error', async () => {
    const deps: PrescribeDeps = {
      provider: {
        name: 'gemini',
        generateJSON: async () => {
          throw new Error('should not be called');
        },
      },
      readSource: () => 'content',
      loadReferencePatch: () => null,
      deriveDiff: () => 'diff',
      newId: () => 'p1',
      now: () => '2026-10-18T10:00:00.000Z',
      isRemote: false,
      geminiConfigured: false,
    };

    await expect(prescribe(deps, sampleFinding, [])).rejects.toThrow(
      'Gemini is selected but not configured in Settings',
    );
  });
});
