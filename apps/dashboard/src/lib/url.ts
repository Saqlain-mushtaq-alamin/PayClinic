/**
 * Validates that a string is a safe HTTP or HTTPS URL to prevent
 * javascript: or data: URL injection in href attributes.
 */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
