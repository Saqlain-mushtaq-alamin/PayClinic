import { posix } from 'node:path';
import type { PatchEdit } from '@payclinic/contracts';

const STORE_SRC_PREFIX = 'apps/buggy-store/src/';
const DEFAULT_MAX_EDITS = 5;
const MAX_REPLACE_CHARS = 4000;
const DENYLIST_PATTERNS: RegExp[] = [
  /\bchild_process\b/i,
  /\bcluster\b/i,
  /\bworker_threads\b/i,
  /\bvm\b/i,
  /\b(fs|node:fs)\b/i,
  /\bwriteFile\b/i,
  /\bprocess\b/i,
  /\bglobalThis\b/i,
  /\bwindow\b/i,
  /\b__proto__\b/i,
  /\.constructor\s*\(/i,
  /\[['"`]constructor['"`]\]/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\brequire\s*\(/i,
  /\bimport\s*[\(\{]/i,
  /https?:\/\//i,
];

export interface CheckEditsSafetyOptions {
  maxEdits?: number;
  allowedPrefix?: string;
}

/** Returns a failure when AI-generated edits could escape the store source or execute code. */
export function checkEditsSafety(
  edits: PatchEdit[],
  opts: CheckEditsSafetyOptions = {},
): { ok: true } | { ok: false; reason: string } {
  const maxEdits = opts.maxEdits ?? DEFAULT_MAX_EDITS;
  if (edits.length > maxEdits) {
    return { ok: false, reason: `Patch has ${edits.length} edits; the maximum is ${maxEdits}` };
  }

  const rawPrefix = opts.allowedPrefix ?? STORE_SRC_PREFIX;
  const normalizedPrefix = posix.normalize(rawPrefix.replace(/\\/g, '/')).replace(/^\/+/, '');
  const prefixWithSlash = normalizedPrefix.endsWith('/')
    ? normalizedPrefix
    : `${normalizedPrefix}/`;

  for (const [index, edit] of edits.entries()) {
    const rawFile = edit.file.replace(/\\/g, '/');
    const normalized = posix.normalize(rawFile).replace(/^\/+/, '');
    const isUnderPrefix =
      normalized.startsWith(prefixWithSlash) || normalized === normalizedPrefix.replace(/\/$/, '');

    if (
      !isUnderPrefix ||
      rawFile.split('/').includes('..') ||
      normalized.split('/').includes('..') ||
      posix.isAbsolute(rawFile)
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

    for (const pattern of DENYLIST_PATTERNS) {
      if (pattern.test(edit.replace)) {
        return {
          ok: false,
          reason: `Edit ${index + 1} replace text matches restricted pattern ${pattern.toString()}`,
        };
      }
    }
  }

  return { ok: true };
}
