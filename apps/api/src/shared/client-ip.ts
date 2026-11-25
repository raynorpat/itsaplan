// The server's view of a request's connection, as Bun's server gives it.
export type ConnectionInfo = { requestIP(r: Request): { address: string } | null } | null;

// The client address: from the proxy headers when TRUST_PROXY=true (the API runs behind
// a proxy that sets them), otherwise the connection's own address. Without a trusted
// proxy the headers are ignored, since any client can send them.
export function clientIp(request: Request, server: ConnectionInfo): string | null {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || request.headers.get('x-real-ip') || null;
  }
  return server?.requestIP(request)?.address ?? null;
}

// The client's country (ISO 3166-1 alpha-2) from a trusted proxy's header
// (Cloudflare's CF-IPCountry), or null without a trusted proxy.
export function clientCountry(request: Request): string | null {
  if (process.env.TRUST_PROXY !== 'true') return null;
  const code = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
