import type { Finding } from '@payclinic/contracts';

export interface FetchSourcesProject {
  repoOwner?: string | null;
  repo_owner?: string | null;
  repoName?: string | null;
  repo_name?: string | null;
  repoBranch?: string | null;
  repo_branch?: string | null;
  sourceRoot?: string | null;
  source_root?: string | null;
}

export interface GitHubSourcesClient {
  getTree(params: { owner: string; repo: string; tree_sha: string; recursive?: string }): Promise<{
    data: { tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }> };
  }>;
  getContent(params: {
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }): Promise<{ data: { content?: string; encoding?: string; type?: string } }>;
}

export interface FetchProjectSourcesOptions {
  token?: string;
  githubClient?: GitHubSourcesClient;
  maxFiles?: number;
  maxTotalBytes?: number;
  fetchFn?: typeof fetch;
}

export const SCENARIO_KEYWORDS = [
  'orders',
  'pricing',
  'price',
  'total',
  'capture',
  'refund',
  'webhook',
  'money',
  'currency',
  'amount',
] as const;

export const SKIP_PATTERNS = [
  /\/node_modules\//i,
  /^node_modules\//i,
  /\/dist\//i,
  /^dist\//i,
  /\.lock$/i,
  /-lock\.json$/i,
  /-lock\.yaml$/i,
  /yarn\.lock$/i,
  /bun\.lockb$/i,
  /\.git\//i,
  /^(\.git|node_modules|dist)$/i,
];

export function isSkippedFile(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SKIP_PATTERNS.some((p) => p.test(normalized));
}

export function matchesKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return SCENARIO_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Fetches remote project source files from GitHub matching scenario keywords,
 * capped at maxFiles (default 8) and maxTotalBytes (default 60 KB).
 */
export async function fetchProjectSources(
  project: FetchSourcesProject,
  _finding: Finding,
  opts: FetchProjectSourcesOptions = {},
): Promise<Map<string, string>> {
  const owner = project.repoOwner ?? project.repo_owner;
  const repo = project.repoName ?? project.repo_name;
  if (!owner || !repo) {
    throw new Error('Project repository is not configured (missing repo_owner or repo_name)');
  }
  const branch = project.repoBranch ?? project.repo_branch ?? 'main';
  const rawSourceRoot = project.sourceRoot ?? project.source_root ?? '';
  const sourceRoot = rawSourceRoot
    ? rawSourceRoot.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    : '';

  const maxFiles = opts.maxFiles ?? 8;
  const maxTotalBytes = opts.maxTotalBytes ?? 60 * 1024;
  const token = opts.token;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  let treeItems: Array<{ path: string; size?: number; type?: string }> = [];

  if (opts.githubClient) {
    const res = await opts.githubClient.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: 'true',
    });
    treeItems = (res.data.tree ?? []).filter(
      (item): item is { path: string; size?: number; type?: string } =>
        typeof item.path === 'string',
    );
  } else {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'PayClinic',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch repo tree from GitHub: HTTP ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as {
      tree?: Array<{ path?: string; size?: number; type?: string }>;
    };
    treeItems = (data.tree ?? []).filter(
      (item): item is { path: string; size?: number; type?: string } =>
        typeof item.path === 'string',
    );
  }

  // Filter items:
  // 1. type must be 'blob' if present
  // 2. must be under sourceRoot if sourceRoot is set
  // 3. must not match skip patterns (node_modules, dist, lock files)
  const filtered = treeItems.filter((item) => {
    if (item.type && item.type !== 'blob') return false;
    const path = item.path.replace(/\\/g, '/');
    if (isSkippedFile(path)) return false;
    if (sourceRoot) {
      if (!path.startsWith(`${sourceRoot}/`) && path !== sourceRoot) return false;
    }
    return true;
  });

  // Prioritize files where path matches keywords first
  const pathMatching: typeof filtered = [];
  const otherCandidates: typeof filtered = [];

  for (const item of filtered) {
    if (matchesKeywords(item.path)) {
      pathMatching.push(item);
    } else {
      otherCandidates.push(item);
    }
  }

  const prioritized = [...pathMatching, ...otherCandidates];
  const resultMap = new Map<string, string>();
  let totalBytes = 0;

  for (const item of prioritized) {
    if (resultMap.size >= maxFiles || totalBytes >= maxTotalBytes) {
      break;
    }

    if (item.size !== undefined && item.size > maxTotalBytes) {
      continue;
    }

    let content = '';
    if (opts.githubClient) {
      const res = await opts.githubClient.getContent({
        owner,
        repo,
        path: item.path,
        ref: branch,
      });
      const data = res.data;
      if (data.content !== undefined) {
        content = Buffer.from(
          data.content,
          data.encoding === 'base64' ? 'base64' : 'utf8',
        ).toString('utf8');
      }
    } else {
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(item.path)}?ref=${encodeURIComponent(branch)}`;
      const res = await fetchFn(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'User-Agent': 'PayClinic',
        },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { content?: string; encoding?: string };
      if (data.content !== undefined) {
        content = Buffer.from(
          data.content,
          data.encoding === 'base64' ? 'base64' : 'utf8',
        ).toString('utf8');
      }
    }

    const isKeywordMatch = matchesKeywords(item.path) || matchesKeywords(content);
    if (!isKeywordMatch) {
      continue;
    }

    const contentByteLength = Buffer.byteLength(content, 'utf8');
    if (totalBytes + contentByteLength > maxTotalBytes) {
      if (resultMap.size > 0) {
        break;
      }
      continue;
    }

    resultMap.set(item.path, content);
    totalBytes += contentByteLength;
  }

  return resultMap;
}
