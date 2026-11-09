import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export type Database = BetterSqlite3.Database;

/** Opens the PayClinic SQLite database and applies the schema. */
export function openDb(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BetterSqlite3(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  // Migration: add project_id to runs if missing (for pre-existing databases)
  const runColumns = db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
  const hasProjectId = runColumns.some((col) => col.name === 'project_id');
  if (!hasProjectId) {
    db.exec('ALTER TABLE runs ADD COLUMN project_id TEXT');
  }

  // Seed builtin project if missing
  const builtin = db.prepare('SELECT id FROM projects WHERE id = ?').get('builtin');
  if (!builtin) {
    db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, kind, proxy_token, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('builtin', 'Demo store', 'builtin', randomUUID().replace(/-/g, ''), new Date().toISOString());
  }

  return db;
}
