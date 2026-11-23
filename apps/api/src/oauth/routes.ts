import { auth, MCP_CLIENT_SCOPES, OAUTH_SCOPES, revokeOAuthAccessToken } from '@repo/auth';

// Linear's OAuth paths on the API, forwarded to better-auth's OAuth provider plugin
// (/api/auth/oauth2/*), so an application written for Linear changes only its base
// URLs. The scope and token adaptations happen in the plugin's hook
// (packages/auth/src/oauth.ts), whichever path a request came in on.
//
// - GET  /oauth/authorize   the authorization step (browser)
// - POST /oauth/token       code, refresh and client_credentials grants
// - POST /oauth/revoke      Linear's form: `Authorization: Bearer <token>` revokes that
//                           token; otherwise the standard form with client credentials
// - POST /oauth/register    dynamic client registration (MCP clients)
// - GET  /.well-known/oauth-authorization-server   the server metadata (RFC 8414)
// - GET  /.well-known/oauth-protected-resource[/mcp]   the MCP endpoint's resource
//                           metadata (RFC 9728), where an MCP client starts signing in

const FORWARDED = {
  '/oauth/authorize': '/api/auth/oauth2/authorize',
  '/oauth/token': '/api/auth/oauth2/token',
  '/oauth/revoke': '/api/auth/oauth2/revoke',
  '/oauth/register': '/api/auth/oauth2/register',
} as const;

async function forward(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = path;
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  return auth.handler(new Request(url, { method: request.method, headers: request.headers, body }));
}

// The server metadata, pointing at the paths above.
export function authorizationServerMetadata(apiUrl: string) {
  return {
    issuer: apiUrl,
    authorization_endpoint: `${apiUrl}/oauth/authorize`,
    token_endpoint: `${apiUrl}/oauth/token`,
    revocation_endpoint: `${apiUrl}/oauth/revoke`,
    registration_endpoint: `${apiUrl}/oauth/register`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
  };
}

// The MCP endpoint's resource metadata. It lists only the scopes a self-registered
// MCP client may ask for, since that is what an MCP client registers with.
export function protectedResourceMetadata(apiUrl: string) {
  return {
    resource: `${apiUrl}/mcp`,
    authorization_servers: [apiUrl],
    scopes_supported: [...MCP_CLIENT_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Itsaplan MCP',
  };
}

// Typed as `any` for the same reason as mountMcp: Elysia's generics are invariant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountOAuth(app: any): void {
  const apiUrl = process.env.API_URL!;
  const options = { parse: 'none', detail: { hide: true } } as const;
  app.get(
    '/oauth/authorize',
    ({ request }: { request: Request }) => forward(request, FORWARDED['/oauth/authorize']),
    options,
  );
  app.post(
    '/oauth/token',
    ({ request }: { request: Request }) => forward(request, FORWARDED['/oauth/token']),
    options,
  );
  app.post(
    '/oauth/register',
    ({ request }: { request: Request }) => forward(request, FORWARDED['/oauth/register']),
    options,
  );
  app.post(
    '/oauth/revoke',
    async ({ request }: { request: Request }) => {
      const bearer = request.headers
        .get('authorization')
        ?.match(/^Bearer\s+(.+)$/i)?.[1]
        ?.trim();
      if (bearer) {
        if (await revokeOAuthAccessToken(bearer)) return new Response(null, { status: 200 });
        return Response.json(
          { error: 'invalid_token', error_description: 'token not found' },
          { status: 400 },
        );
      }
      return forward(request, FORWARDED['/oauth/revoke']);
    },
    options,
  );
  app.get('/.well-known/oauth-authorization-server', () =>
    Response.json(authorizationServerMetadata(apiUrl)),
  );
  // The MCP endpoint as a protected resource (RFC 9728). MCP clients probe the path
  // with the resource's path appended, and the bare path.
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])
    app.get(path, () => Response.json(protectedResourceMetadata(apiUrl)));
}
