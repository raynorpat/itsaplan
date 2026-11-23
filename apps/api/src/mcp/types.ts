import type { SessionUser } from '../shared/auth-context';
import type { RequestAuth } from '../shared/request-auth';

// The minimal surface of the assembled Elysia app the MCP layer uses: route
// introspection and in-process dispatch. A structural type (not Elysia<...>) so a
// concrete app is assignable without hitting Elysia's invariant generics.
export interface McpApp {
  routes: ReadonlyArray<{ method: string; path: string; hooks: unknown }>;
  handle: (request: Request) => Promise<Response>;
}

// Who an MCP request acts as: an API key, forwarded to the routes as x-api-key; or an
// OAuth token, already checked by the endpoint, whose user and scopes the tool calls
// run with (dispatch.ts).
export type McpCaller =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'oauth'; user: SessionUser; auth: Extract<RequestAuth, { kind: 'oauth' }> };
