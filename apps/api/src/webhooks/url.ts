import { HttpError } from '../shared/lib';

// A local, loopback, or private-range host — the SSRF-sensitive targets.
// IPv6 literals arrive bracketed from URL.hostname ("[::1]"); an IPv4-mapped
// address (::ffff:127.0.0.1, or its hex form) is checked as the IPv4 it maps to.
function isLocalHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped) return isLocalHost(mappedIpv4(mapped[1]!));
  return (
    host === '::' ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host)
  );
}

// The IPv4 address an IPv4-mapped IPv6 suffix stands for: "127.0.0.1" as is, or
// the hex form "7f00:1" converted to dotted decimal.
function mappedIpv4(suffix: string): string {
  if (suffix.includes('.')) return suffix;
  const [hi = '0', lo = '0'] = suffix.split(':');
  const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16);
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

// An IPv4 or IPv6 literal (as opposed to a DNS name).
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

// Rejects urls that are not https or that point at a local/private address, so a
// subscription cannot be pointed at internal services (SSRF). The DNS-level check
// belongs to the delivery side; this is the syntactic guard at registration time.
//
// Exception for local development (NODE_ENV neither production nor test): a
// localhost / 0.0.0.0 / IP-literal target is allowed over http, so a local test
// receiver (e.g. http://localhost:3000/webhook-test/sink) can be registered.
// Production and the test suite stay strict.
export function validateWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Webhook url must be a valid URL');
  }
  const host = url.hostname.toLowerCase();

  const devRelaxed =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'test' &&
    (isLocalHost(host) || isIpLiteral(host));
  if (devRelaxed) return raw;

  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'Webhook url must use https');
  }
  if (isLocalHost(host)) {
    throw new HttpError(400, 'Webhook url must not point to a private or local address');
  }
  return raw;
}
