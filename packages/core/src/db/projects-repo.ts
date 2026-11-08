import type { Database } from './db';

export interface ProjectRow {
  id: string;
  name: string;
  kind: 'builtin' | 'remote';
  baseUrl: string | null;
  adminSecretEncrypted: string | null;
  proxyToken: string;
  repoOwner: string | null;
  repoName: string | null;
  repoBranch: string | null;
  sourceRoot: string | null;
  createdAt: string;
}

export interface InsertProjectInput {
  id: string;
  name: string;
  kind: 'builtin' | 'remote';
  baseUrl?: string | null;
  adminSecretEncrypted?: string | null;
  proxyToken: string;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  sourceRoot?: string | null;
  createdAt?: string;
}

export interface UpdateProjectInput {
  name?: string;
  baseUrl?: string | null;
  adminSecretEncrypted?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  sourceRoot?: string | null;
}

export interface ProjectsRepo {
  listProjects(): ProjectRow[];
  getProject(id: string): ProjectRow | null;
  getProjectByProxyToken(proxyToken: string): ProjectRow | null;
  insertProject(p: InsertProjectInput): void;
  updateProject(id: string, patch: UpdateProjectInput): void;
  deleteProject(id: string): void;
}

function parseProjectRow(r: any): ProjectRow {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    baseUrl: r.base_url ?? null,
    adminSecretEncrypted: r.admin_secret_encrypted ?? null,
    proxyToken: r.proxy_token,
    repoOwner: r.repo_owner ?? null,
    repoName: r.repo_name ?? null,
    repoBranch: r.repo_branch ?? null,
    sourceRoot: r.source_root ?? null,
    createdAt: r.created_at,
  };
}

export function createProjectsRepo(db: Database): ProjectsRepo {
  return {
    listProjects(): ProjectRow[] {
      const rows = db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all();
      return rows.map(parseProjectRow);
    },

    getProject(id: string): ProjectRow | null {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      return row ? parseProjectRow(row) : null;
    },

    getProjectByProxyToken(proxyToken: string): ProjectRow | null {
      const row = db.prepare('SELECT * FROM projects WHERE proxy_token = ?').get(proxyToken);
      return row ? parseProjectRow(row) : null;
    },

    insertProject(p: InsertProjectInput): void {
      const createdAt = p.createdAt ?? new Date().toISOString();
      db.prepare(
        `INSERT INTO projects (
           id, name, kind, base_url, admin_secret_encrypted, proxy_token,
           repo_owner, repo_name, repo_branch, source_root, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.id,
        p.name,
        p.kind,
        p.baseUrl ?? null,
        p.adminSecretEncrypted ?? null,
        p.proxyToken,
        p.repoOwner ?? null,
        p.repoName ?? null,
        p.repoBranch ?? null,
        p.sourceRoot ?? null,
        createdAt,
      );
    },

    updateProject(id: string, patch: UpdateProjectInput): void {
      const entries: Array<[string, string | null]> = [];
      if (patch.name !== undefined) entries.push(['name', patch.name]);
      if (patch.baseUrl !== undefined) entries.push(['base_url', patch.baseUrl]);
      if (patch.adminSecretEncrypted !== undefined) {
        entries.push(['admin_secret_encrypted', patch.adminSecretEncrypted]);
      }
      if (patch.repoOwner !== undefined) entries.push(['repo_owner', patch.repoOwner]);
      if (patch.repoName !== undefined) entries.push(['repo_name', patch.repoName]);
      if (patch.repoBranch !== undefined) entries.push(['repo_branch', patch.repoBranch]);
      if (patch.sourceRoot !== undefined) entries.push(['source_root', patch.sourceRoot]);

      if (entries.length === 0) return;

      const assignments = entries.map(([col]) => `${col} = ?`).join(', ');
      const values = entries.map(([, val]) => val);
      db.prepare(`UPDATE projects SET ${assignments} WHERE id = ?`).run(...values, id);
    },

    deleteProject(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    },
  };
}

