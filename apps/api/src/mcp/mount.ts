import { t } from 'elysia';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getActiveSession, OAUTH_ACCESS_TOKEN_PREFIX } from '@repo/auth';
import { resolveOAuth } from '../graphql/context';
import { buildMcpServer } from './server';
import type { McpApp, McpCaller } from './types';

// The credential on the request. MCP clients send Authorization: Bearer <token>, an
// OAuth access token or an API key; x-api-key is also accepted (the REST convention).
// The session cookie is not: an MCP client has none. Returns null when absent.
function extractCredential(request: Request): string | null {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  return bearer ?? request.headers.get('x-api-key') ?? null;
}

// Who the request acts as, or null when the credential is not valid.
async function resolveCaller(credential: string): Promise<McpCaller | null> {
  if (credential.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
    const resolved = await resolveOAuth(credential);
    if (!resolved || resolved.auth.kind !== 'oauth') return null;
    return { kind: 'oauth', user: resolved.user, auth: resolved.auth };
  }
  const headers = new Headers();
  headers.set('x-api-key', credential);
  const session = await getActiveSession(headers).catch(() => null);
  return session ? { kind: 'apiKey', apiKey: credential } : null;
}

// Where an MCP client finds how to sign in (RFC 9728), sent with every 401 (the MCP
// authorization spec).
export const mcpResourceMetadataUrl = (apiUrl: string) =>
  `${apiUrl}/.well-known/oauth-protected-resource/mcp`;

// Adds the MCP endpoint (POST /mcp) to the app and returns the same app. Mounted on
// the root app, outside the planner session guard, because the MCP handshake is not
// a planner route: auth is resolved here and the caller is passed to the loopback
// requests the tools make (dispatch.ts). `app` is captured so the tool generator can read
// app.routes and each tool call can dispatch through app.handle.
//
// Stateless transport (sessionIdGenerator undefined): a fresh server and transport
// per request. The credential is validated once here so an unauthenticated caller
// gets a 401, pointing at the resource metadata, instead of a tool list.
// Typed as `any` because it is the composition root: it needs Elysia's `.post` to
// register the route, and Elysia's generics are invariant, so a precise parameter
// type would reject the concrete app. The captured `app` is passed on as McpApp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountMcp(app: any): void {
  const mcpApp = app as McpApp;
  app.post(
    '/mcp',
    async ({
      request,
      body,
      set,
    }: {
      request: Request;
      body: unknown;
      set: { status?: number; headers: Record<string, string> };
    }) => {
      const credential = extractCredential(request);
      const caller = credential ? await resolveCaller(credential) : null;
      if (caller) {
        const server = buildMcpServer(mcpApp, caller);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        // Pass the body Elysia already parsed so the request stream is not read twice.
        return transport.handleRequest(request, { parsedBody: body });
      }
      set.status = 401;
      set.headers['www-authenticate'] =
        `Bearer resource_metadata="${mcpResourceMetadataUrl(process.env.API_URL!)}"` +
        (credential ? ', error="invalid_token"' : '');
      return {
        error:
          'Authentication required. Sign in with OAuth, or send an API key as ' +
          'Authorization: Bearer <key> or x-api-key.',
      };
    },
    {
      body: t.Any(),
      // Kept out of the REST OpenAPI docs: this is a JSON-RPC endpoint, not a REST route.
      detail: { summary: 'MCP Streamable HTTP endpoint', hide: true },
    },
  );
}
