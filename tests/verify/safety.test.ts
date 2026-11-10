import { describe, expect, it } from 'vitest';
import { checkEditsSafety } from '@payclinic/core';

const edit = (over: Partial<{ file: string; search: string; replace: string }> = {}) => ({
  file: 'apps/buggy-store/src/orders/pricing.ts',
  search: 'a',
  replace: 'b',
  ...over,
});

describe('checkEditsSafety', () => {
  it('accepts a normal edit', () => expect(checkEditsSafety([edit()]).ok).toBe(true));
  it('rejects more than 5 edits by default and honors maxEdits', () => {
    const many = Array.from({ length: 6 }, () => edit());
    expect(checkEditsSafety(many).ok).toBe(false);
    expect(checkEditsSafety(many, { maxEdits: 10 }).ok).toBe(true);
  });
  it.each([
    'apps/buggy-store/src/../../package.json',
    'apps/buggy-store/src/../package.json',
    'apps/buggy-store/src/orders/../../../x.ts',
  ])('rejects path traversal %s', (file) =>
    expect(checkEditsSafety([edit({ file })]).ok).toBe(false),
  );
  it.each([
    'process.env.X',
    'process["exit"](0)',
    'process.exit(1)',
    "require('fs')",
    "require ('fs')",
    'eval(x)',
    'eval (x)',
    'new Function("x")',
    'Function("return 1")()',
    'import("x")',
    'child_process',
    'worker_threads',
    'fs.readFileSync',
    'node:fs',
    'writeFile',
    'globalThis.evil',
    'window.evil',
    'obj.__proto__.polluted = 1',
    'obj.constructor("return 1")()',
    'obj["constructor"]("return 1")()',
    'https://evil.example',
    'http://evil.example',
  ])('rejects replace text %s', (replace) =>
    expect(checkEditsSafety([edit({ replace })]).ok).toBe(false),
  );
  it('rejects a replace over 4000 characters', () =>
    expect(checkEditsSafety([edit({ replace: 'x'.repeat(4001) })]).ok).toBe(false));
});
