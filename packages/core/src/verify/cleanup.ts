import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deletes `.payclinic-tmp/` and stale SQLite journal files in `data/`.
 * Safe to run when directories or files do not exist.
 */
export function cleanupTmp(rootDir: string): void {
  const tmpDir = join(rootDir, '.payclinic-tmp');
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  const dataDir = join(rootDir, 'data');
  if (existsSync(dataDir)) {
    try {
      const entries = readdirSync(dataDir);
      for (const entry of entries) {
        if (
          entry.endsWith('.db-journal') ||
          entry.endsWith('.db-wal') ||
          entry.endsWith('.db-shm')
        ) {
          rmSync(join(dataDir, entry), { force: true });
        }
      }
    } catch {
      // Ignore readdir / removal errors
    }
  }
}
