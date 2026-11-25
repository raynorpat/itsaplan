import { t } from 'elysia';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@repo/auth';
import { auditRequestFrom, withAuditRequest } from '../audit/context';
import { resolveGraphQLAuth } from '../graphql/context';
import type { ConnectionInfo } from '../shared/client-ip';
import { buildMcpServer } from './server';
import type { McpApp } from './types';

// The credential on the request. MCP clients send Authorization: Bearer <token>, an
// OAuth access token or an API key; x-api-key is also accepted. The session cookie is
// not: an MCP client has none. Returns null when absent.
function extractCredential(request: Request): string | null {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  return bearer ?? request.headers.get('x-api-key')?.trim() ?? null;
}

// Whether the credential is valid, resolved the way /graphql resolves it.
async function isValid(credential: string): Promise<boolean> {
  const headers = new Headers({ authorization: `Bearer ${credential}` });
  return (await resolveGraphQLAuth(new Request('http://localhost/graphql', { headers }))) !== null;
}

// Where an MCP client finds how to sign in (RFC 9728), sent with every 401 (the MCP
// authorization spec). Each endpoint is its own protected resource.
export const mcpResourceMetadataUrl = (apiUrl: string, path: '/mcp' | '/mcp/readonly') =>
  `${apiUrl}/.well-known/oauth-protected-resource${path}`;

// Adds the MCP endpoints to the app: POST /mcp (every tool) and POST /mcp/readonly
// (read tools only), as Linear's MCP server has. Mounted on the root app; the tools
// run GraphQL in process through `app` with the caller's own credential (graphql.ts).
//
// Stateless transport (sessionIdGenerator undefined): a fresh server and transport
// per request. The credential is validated once here so an unauthenticated caller
// gets a 401, pointing at the resource metadata, instead of a tool list.
// Typed as `any` because it is the composition root: Elysia's generics are invariant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountMcp(app: any): void {
  const mcpApp = app as McpApp;
  for (const path of ['/mcp', '/mcp/readonly'] as const)
    app.post(
      path,
      async ({
        request,
        body,
        set,
        server: connection,
      }: {
        request: Request;
        body: unknown;
        set: { status?: number; headers: Record<string, string> };
        server: ConnectionInfo;
      }) => {
        const credential = extractCredential(request);
        if (credential && (await isValid(credential))) {
          const server = buildMcpServer(mcpApp, credential, path === '/mcp/readonly');
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          await server.connect(transport);
          // Pass the body Elysia already parsed so the request stream is not read twice.
          // The tools' in-process GraphQL requests keep this request's client details
          // for the audit log (graphql/mount.ts).
          const method = credential.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? 'oauth' : 'apiKey';
          return withAuditRequest(auditRequestFrom(request, connection, method), () =>
            transport.handleRequest(request, { parsedBody: body }),
          );
        }
        set.status = 401;
        set.headers['www-authenticate'] =
          `Bearer resource_metadata="${mcpResourceMetadataUrl(process.env.API_URL!, path)}"` +
          (credential ? ', error="invalid_token"' : '');
        return {
          error:
            'Authentication required. Sign in with OAuth, or send an API key as ' +
            'Authorization: Bearer <key>.',
        };
      },
      { body: t.Any(), detail: { summary: 'MCP Streamable HTTP endpoint', hide: true } },
    );
}
