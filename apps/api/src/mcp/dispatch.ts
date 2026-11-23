import { runAsMcpCaller } from '../shared/auth-context';
import { runWithAuth } from '../shared/request-auth';
import type { McpApp, McpCaller } from './types';
import type { McpRouteTool } from './generate';

// Methods that carry a request body; the rest put their arguments in the query.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// Elysia's router needs a multi-label host to parse the path; a single-label host
// like "http://x" fails to route. localhost is never resolved (app.handle runs in
// process), so it is only a syntactically valid base for the URL.
const BASE = 'http://localhost';

// Runs a tool call as an in-process request against the real route and returns the
// response body as text. Path params fill the URL; the remaining arguments become
// the JSON body (POST/PUT/PATCH) or the query string (GET/DELETE). The caller's API
// key is forwarded as x-api-key so the route's session guard and permission checks
// run exactly as they do over HTTP. An OAuth caller's user is passed to the route's
// session guard in process (runAsMcpCaller), with the token's scopes for the role
// checks (runWithAuth), so the route acts as that user within the token's rights.
export async function dispatchTool(
  app: McpApp,
  tool: McpRouteTool,
  args: Record<string, unknown>,
  caller: McpCaller,
): Promise<{ text: string; isError: boolean }> {
  const rest: Record<string, unknown> = { ...args };

  let path = tool.path;
  for (const name of tool.pathParams) {
    path = path.replace(`:${name}`, encodeURIComponent(String(rest[name] ?? '')));
    delete rest[name];
  }

  const hasBody = BODY_METHODS.has(tool.method);
  let url = `${BASE}${path}`;
  let body: string | undefined;
  if (hasBody) {
    body = JSON.stringify(rest);
  } else {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(rest)) {
      if (value != null) qs.set(key, String(value));
    }
    const query = qs.toString();
    if (query) url += `?${query}`;
  }

  const headers = new Headers({ 'content-type': 'application/json' });
  if (caller.kind === 'apiKey') headers.set('x-api-key', caller.apiKey);
  const request = new Request(url, { method: tool.method, headers, body });
  const response =
    caller.kind === 'apiKey'
      ? await app.handle(request)
      : await runAsMcpCaller(caller.user, () =>
          runWithAuth(caller.auth, () => app.handle(request)),
        );
  const text = await response.text();
  return { text, isError: response.status >= 400 };
}
