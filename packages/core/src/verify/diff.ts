import { createTwoFilesPatch } from 'diff';
import type { PatchEdit } from '@payclinic/contracts';

function applyToString(original: string, edits: PatchEdit[], file: string): string {
  let next = original;
  for (const [index, edit] of edits.entries()) {
    const matches = next.split(edit.search).length - 1;
    if (matches !== 1) {
      throw new Error(
        `Edit ${index + 1} for ${file} must match exactly once (found ${matches})`,
      );
    }
    next = next.replace(edit.search, edit.replace);
  }
  return next;
}

/** Builds a display-only unified diff by applying all edits to each referenced file. */
export function derivePatchDiff(
  edits: PatchEdit[],
  readFile: (repoRelativePath: string) => string,
): string {
  const byFile = new Map<string, PatchEdit[]>();
  for (const edit of edits) {
    const existing = byFile.get(edit.file);
    if (existing) existing.push(edit);
    else byFile.set(edit.file, [edit]);
  }

  const patches: string[] = [];
  for (const [file, fileEdits] of byFile) {
    const original = readFile(file);
    const patched = applyToString(original, fileEdits, file);
    patches.push(
      createTwoFilesPatch(`a/${file}`, `b/${file}`, original, patched, undefined, undefined, {
        context: 3,
      }),
    );
  }
  return patches.join('');
}
