import { posix } from 'node:path';
import type { PatchEdit } from '@payclinic/contracts';

const STORE_SRC_PREFIX = 'apps/buggy-store/src/';
const DEFAULT_MAX_EDITS = 5;
const MAX_REPLACE_CHARS = 4000;
const DENYLIST = [
  'child_process',
  'eval(',
  'new Function',
  'process.env',
  'require(',
  'import(',
  'fs.',
  'writeFile',
];

/** Returns a failure when AI-generated edits could escape the store source or execute code. */
export function checkEditsSafety(
  edits: PatchEdit[],
  opts: { maxEdits?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  const maxEdits = opts.maxEdits ?? DEFAULT_MAX_EDITS;
  if (edits.length > maxEdits) {
    return { ok: false, reason: `Patch has ${edits.length} edits; the maximum is ${maxEdits}` };
  }

  for (const [index, edit] of edits.entries()) {
    const normalized = posix.normalize(edit.file.replace(/\\/g, '/'));
    if (
      !normalized.startsWith(STORE_SRC_PREFIX) ||
      normalized.split('/').includes('..') ||
      posix.isAbsolute(normalized)
    ) {
      return {
        ok: false,
        reason: `Edit ${index + 1} has an unsafe path: ${edit.file}`,
      };
    }

    if (edit.replace.length > MAX_REPLACE_CHARS) {
      return {
        ok: false,
        reason: `Edit ${index + 1} replace text is longer than ${MAX_REPLACE_CHARS} characters`,
      };
    }

    for (const token of DENYLIST) {
      if (edit.replace.includes(token)) {
        return { ok: false, reason: `Edit ${index + 1} replace text contains "${token}"` };
      }
    }

    if (/https?:\/\//i.test(edit.replace)) {
      return { ok: false, reason: `Edit ${index + 1} replace text contains a literal URL` };
    }
  }

  return { ok: true };
}
