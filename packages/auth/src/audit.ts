import { APIError } from 'better-auth/api';

// The audit log is written by the API (apps/api src/audit), which this package does not
// import: the API registers its writers at startup (setAuditHook) and the better-auth
// hooks call them. Without a registered hook nothing is recorded. The writers are fail
// open: an entry that cannot be written never fails the sign-in.

export interface AuditHook {
  record(
    type: string,
    metadata: Record<string, unknown> | null,
    actorId: string | null,
  ): Promise<void>;
  loginFailed(address: string, reason: string): Promise<void>;
  // Whether this request already recorded a refused sign-in with its address.
  refusalRecorded(): boolean;
}

let hook: AuditHook | null = null;

// The header the API sets on each request it hands better-auth with the client address
// it works out (TRUST_PROXY decides whether proxy headers count); better-auth reads the
// address from it for rate limits and sessions.
export const CLIENT_IP_HEADER = 'x-itsaplan-client-ip';

export function setAuditHook(next: AuditHook): void {
  hook = next;
}

export async function auditRecord(
  type: string,
  metadata: Record<string, unknown> | null,
  actorId: string | null,
): Promise<void> {
  await hook?.record(type, metadata, actorId);
}

export async function auditLoginFailed(address: string, reason: string): Promise<void> {
  await hook?.loginFailed(address, reason);
}

// Whether this request already recorded a refused sign-in under its address (the
// database hooks and the magic-link checks know it), so the after hook adds no second
// entry without one. better-auth may hand the after hook the refusal as a code or, after
// an OAuth callback, as its message, so the request is marked instead of matching codes.
export function auditRefusalRecorded(): boolean {
  return hook?.refusalRecorded() ?? false;
}

// A refusal code as the audit log stores it: NOT_INVITED → notInvited.
export function reasonOf(code: string): string {
  return code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// The error code of an endpoint's result: an APIError's body code, or the `error`
// parameter of a redirect to an error page. Null for a success.
export function resultErrorCode(returned: unknown, headers: Headers | undefined): string | null {
  if (!(returned instanceof APIError)) return null;
  if (returned.statusCode >= 300 && returned.statusCode < 400) {
    const own = returned.headers ? new Headers(returned.headers).get('location') : null;
    const location = own ?? headers?.get('location') ?? null;
    if (!location) return null;
    try {
      return new URL(location, 'http://localhost').searchParams.get('error');
    } catch {
      return null;
    }
  }
  const body = returned.body as { code?: unknown } | undefined;
  return typeof body?.code === 'string' && body.code ? body.code : 'UNKNOWN';
}
