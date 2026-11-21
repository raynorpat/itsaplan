import { HttpError } from '../shared/lib';

// A local, loopback, or private-range host — the SSRF-sensitive targets.
function isLocalHost(host: string): boolean {
  return (
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
