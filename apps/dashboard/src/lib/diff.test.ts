import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff';

describe('parseUnifiedDiff', () => {
  it('classifies each line of a unified diff (P2-C02)', () => {
    const lines = parseUnifiedDiff('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n context\n');

    expect(lines).toEqual([
      { kind: 'meta', text: '--- a/x.ts' },
      { kind: 'meta', text: '+++ b/x.ts' },
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: '-old' },
      { kind: 'add', text: '+new' },
      { kind: 'ctx', text: ' context' },
    ]);
  });

  it('returns no lines for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
