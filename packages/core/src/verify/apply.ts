import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { PatchEdit } from '@payclinic/contracts';

const STORE_PREFIX = 'apps/buggy-store/';
const STORE_SRC_PREFIX = 'apps/buggy-store/src/';

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) return count;
    count += 1;
    from = found + needle.length;
  }
}

/** Applies exact-string edits to a copied store directory, in order. */
export function applyEditsToDir(
  storeDir: string,
  edits: PatchEdit[],
): { ok: true } | { ok: false; reason: string } {
  for (const [index, edit] of edits.entries()) {
    const normalized = posix.normalize(edit.file.replace(/\\/g, '/'));
    if (!normalized.startsWith(STORE_SRC_PREFIX) || normalized.split('/').includes('..')) {
      return { ok: false, reason: `Edit ${index + 1} has an unsafe path: ${edit.file}` };
    }

    const target = join(storeDir, ...normalized.slice(STORE_PREFIX.length).split('/'));
    let original: string;
    try {
      original = readFileSync(target, 'utf8');
    } catch {
      return {
        ok: false,
        reason: `Edit ${index + 1} could not read ${edit.file}`,
      };
    }

    const matches = countOccurrences(original, edit.search);
    if (matches === 0) {
      return {
        ok: false,
        reason: `Edit ${index + 1} search text not found (0 matches) in ${edit.file}`,
      };
    }
    if (matches > 1) {
      return {
        ok: false,
        reason: `Edit ${index + 1} search text matches more than once (${matches} matches) in ${edit.file}`,
      };
    }

    writeFileSync(target, original.replace(edit.search, edit.replace), 'utf8');
  }

  return { ok: true };
}
