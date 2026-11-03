export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Classifies the lines of a unified diff for rendering. Pure. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return lines.map((text) => ({ text, kind: classifyLine(text) }));
}

function classifyLine(text: string): DiffLineKind {
  if (text.startsWith('---') || text.startsWith('+++')) return 'meta';
  if (text.startsWith('@@')) return 'hunk';
  if (text.startsWith('+')) return 'add';
  if (text.startsWith('-')) return 'del';
  return 'ctx';
}
