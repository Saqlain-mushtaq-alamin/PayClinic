import dns from 'node:dns';
import net from 'node:net';

/** Raised when a remote target URL violates SSRF or network boundary safety rules. */
export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

/** Returns true if an IP address is loopback, private, link-local, unspecified, or multicast. */
export function isPrivateOrLocalIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  if (clean.startsWith('::ffff:')) {
    return isPrivateOrLocalIp(clean.slice(7));
  }

  // IPv4 address
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map((p) => parseInt(p, 10));
    const [a, b] = parts as [number, number, number, number];

    // 0.0.0.0/8 (current network)
    if (a === 0) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 10.0.0.0/8 (private)
    if (a === 10) return true;
    // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local, cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 100.64.0.0/10 (carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 224.0.0.0/4 (multicast) and 255.255.255.255 (broadcast)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 address
  if (net.isIPv6(clean)) {
    if (clean === '::1' || clean === '::') return true;
    // Link-local: fe80::/10 (fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(clean)) return true;
    // Unique local: fc00::/7 (fc, fd)
    if (/^f[cd]/i.test(clean)) return true;
    // Multicast: ff00::/8
    if (clean.startsWith('ff')) return true;

    return false;
  }

  return false;
}

export interface AssertSafeTargetOptions {
  dnsLookup?: (
    hostname: string,
    options: { all: boolean },
  ) => Promise<Array<{ address: string; family: number }>>;
}

/**
 * Validates that a target URL is an HTTP(S) URL and does not resolve to loopback,
 * private, link-local, or cloud metadata endpoints unless PAYCLINIC_ALLOW_PRIVATE_TARGETS=1.
 */
export async function assertSafeTarget(
  urlStr: string,
  opts?: AssertSafeTargetOptions,
): Promise<{ url: URL; resolvedIps: string[] }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new UnsafeTargetError(`Invalid URL: ${urlStr}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeTargetError(`Protocol must be http: or https:, got: ${parsed.protocol}`);
  }

  // Bypass allowed strictly for local development when explicitly opted in
  if (process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS === '1') {
    return { url: parsed, resolvedIps: [] };
  }

  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');

  if (rawHost.toLowerCase() === 'localhost') {
    throw new UnsafeTargetError('Target host localhost is not allowed');
  }

  // Direct IP check
  if (net.isIP(rawHost) && isPrivateOrLocalIp(rawHost)) {
    throw new UnsafeTargetError(`Target host is private, loopback, or link-local: ${rawHost}`);
  }

  if (rawHost.toLowerCase() === 'localhost') {
    throw new UnsafeTargetError('Target host localhost is not allowed');
  }

  const lookupFn = opts?.dnsLookup ?? dns.promises.lookup;
  let addresses: Array<{ address: string; family: number }>;
  try {
    const rawResult = await (lookupFn as any)(rawHost, { all: true });
    addresses = Array.isArray(rawResult) ? rawResult : [rawResult];
  } catch (err) {
    throw new UnsafeTargetError(
      `Could not resolve target host ${rawHost}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!addresses || addresses.length === 0) {
    throw new UnsafeTargetError(`Target host ${rawHost} resolved to 0 IP addresses`);
  }

  const resolvedIps = addresses.map((a) => a.address);
  for (const addr of addresses) {
    if (isPrivateOrLocalIp(addr.address)) {
      throw new UnsafeTargetError(
        `Target host ${rawHost} resolves to private or loopback IP: ${addr.address}`,
      );
    }
  }

  return { url: parsed, resolvedIps };
}

/**
 * Executes a fetch to a safe target, re-checking DNS resolution and preventing
 * redirects to different hosts.
 */
export async function safeFetch(
  urlStr: string,
  init?: RequestInit,
  opts?: AssertSafeTargetOptions,
): Promise<Response> {
  const { url: initialUrl } = await assertSafeTarget(urlStr, opts);

  // Manual redirect handling to enforce no redirects to a different host
  const response = await fetch(initialUrl.toString(), {
    ...init,
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new UnsafeTargetError('Redirect response without location header');
    }

    const redirectUrl = new URL(location, initialUrl);
    if (redirectUrl.host !== initialUrl.host) {
      throw new UnsafeTargetError(
        `Redirect to a different host (${redirectUrl.host} != ${initialUrl.host}) is blocked`,
      );
    }

    // Re-verify redirect target
    await assertSafeTarget(redirectUrl.toString(), opts);
    return fetch(redirectUrl.toString(), { ...init, redirect: 'manual' });
  }

  return response;
}
