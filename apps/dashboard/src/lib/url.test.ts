import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl } from './url';

describe('isSafeHttpUrl', () => {
  it('allows valid http and https URLs', () => {
    expect(isSafeHttpUrl('http://localhost:3000')).toBe(true);
    expect(isSafeHttpUrl('https://example.com/api')).toBe(true);
    expect(isSafeHttpUrl('https://github.com/my-org/my-repo/pull/1')).toBe(true);
  });

  it('rejects javascript:, data:, and other dangerous schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('JAVASCRIPT:alert(document.cookie)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects null, undefined, and empty strings', () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });
});
