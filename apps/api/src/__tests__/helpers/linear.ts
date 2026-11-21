import { LinearClient } from '@linear/sdk';
import { auth } from '@repo/auth';
import { app } from '../../app';

// The Linear SDK only talks HTTP, so the in-memory app is served on a random local
// port for the GraphQL tests. Started on first use, shared by every test file.
let server: ReturnType<typeof Bun.serve> | null = null;

export function graphqlUrl(): string {
  server ??= Bun.serve({ port: 0, fetch: (request) => app.handle(request) });
  return `http://localhost:${server.port}/graphql`;
}

// Creates an API key for the user behind the session cookie and returns its secret.
export async function createApiKey(cookie: string): Promise<string> {
  const res = await auth.api.createApiKey({
    body: { name: 'test' },
    headers: new Headers({ cookie }),
  });
  return res.key;
}

// A Linear SDK client authenticated with the API key, pointed at this app.
export function linearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey, apiUrl: graphqlUrl() });
}

// A raw GraphQL request, for cases the SDK does not cover (headers, errors).
export async function gql(
  headers: Record<string, string>,
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ status: number; body: { data?: Record<string, unknown>; errors?: GqlError[] } }> {
  const res = await fetch(graphqlUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json() };
}

export interface GqlError {
  message: string;
  extensions?: { code?: string; userPresentableMessage?: string };
}
