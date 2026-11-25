import { AsyncLocalStorage } from 'node:async_hooks';
import { clientCountry, clientIp, type ConnectionInfo } from '../shared/client-ip';

// The request details an audit entry records: where the request came from and how it
// authenticated. Set around every request that can record an entry (GraphQL, the
// better-auth routes with the instance endpoints, the worker's internal routes) so the
// stores far from the request can read them.

export type AuditMethod = 'session' | 'apiKey' | 'oauth' | 'accessKey' | 'worker' | 'system';

export interface AuditRequestDetails {
  ip: string | null;
  countryCode: string | null;
  userAgent: string | null;
  method: AuditMethod;
  oauthApp?: { id: string; name: string | null };
  pipelineId?: string;
  // The route path, or the GraphQL operation name.
  operation?: string | null;
}

const storage = new AsyncLocalStorage<AuditRequestDetails>();

export function withAuditRequest<T>(details: AuditRequestDetails, run: () => T): T {
  return storage.run(details, run);
}

// The current request's details; a system action outside any request otherwise.
export function currentAuditRequest(): AuditRequestDetails {
  return storage.getStore() ?? { ip: null, countryCode: null, userAgent: null, method: 'system' };
}

// Adds what is learnt after the details were set (the authenticated method, the GraphQL
// operation) to the current request's details.
export function noteAuditRequest(extra: Partial<AuditRequestDetails>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, extra);
}

// A request's details. `method` is how the request authenticated, when known; a
// request with an API key header or a bearer credential reads as `apiKey` until the
// caller says otherwise.
export function auditRequestFrom(
  request: Request,
  server: ConnectionInfo,
  method?: AuditMethod,
): AuditRequestDetails {
  const credential =
    request.headers.get('x-api-key') != null || request.headers.get('authorization') != null;
  return {
    ip: clientIp(request, server),
    countryCode: clientCountry(request),
    userAgent: request.headers.get('user-agent'),
    method: method ?? (credential ? 'apiKey' : 'session'),
    operation: new URL(request.url).pathname,
  };
}
