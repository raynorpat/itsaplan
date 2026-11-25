import { isIP } from 'node:net';

// The server's view of a request's connection, as Bun's server gives it.
export type ConnectionInfo = { requestIP(r: Request): { address: string } | null } | null;

// The client address: from the proxy headers when TRUST_PROXY=true (the API runs behind
// a proxy that overwrites X-Forwarded-For or X-Real-IP with the client's address; one
// that appends to a client's own header lets the client choose the first hop),
// otherwise the connection's own address. Without a trusted proxy the headers are
// ignored, since any client can send them. Anything that is not an IP address is null.
export function clientIp(request: Request, server: ConnectionInfo): string | null {
  const raw =
    process.env.TRUST_PROXY === 'true'
      ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip')?.trim() ||
        null
      : (server?.requestIP(request)?.address ?? null);
  return raw && isIP(raw) ? raw : null;
}

// The client's country (ISO 3166-1 alpha-2) from a trusted proxy's header
// (AUDIT_COUNTRY_HEADER, Cloudflare's CF-IPCountry by default), or null without a
// trusted proxy.
export function clientCountry(request: Request): string | null {
  if (process.env.TRUST_PROXY !== 'true') return null;
  const header = process.env.AUDIT_COUNTRY_HEADER?.trim() || 'cf-ipcountry';
  const code = request.headers.get(header)?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
