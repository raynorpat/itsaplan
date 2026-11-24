import type { McpApp } from './types';

// An error a tool reports to the client as its result (isError), with a message a
// model can act on. Anything else a tool throws is an internal error.
export class ToolError extends Error {}

// Runs one GraphQL operation and returns its data; GraphQL errors become a ToolError.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Gql = <T = any>(query: string, variables?: Record<string, unknown>) => Promise<T>;

interface GraphQLResponse {
  data?: unknown;
  errors?: { message: string; extensions?: { userPresentableMessage?: string } }[];
}

// A GraphQL runner that acts as the MCP caller: each operation is an in-process
// request to /graphql carrying the caller's own credential (an API key or an OAuth
// access token), so GraphQL resolves the same identity and applies its own access and
// scope checks. Nothing beyond what the caller sent is added to the request.
export function graphqlAs(app: McpApp, credential: string): Gql {
  return async (query, variables) => {
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify({ query, variables }),
      }),
    );
    const body = (await res.json()) as GraphQLResponse;
    if (body.errors?.length)
      throw new ToolError(
        body.errors.map((e) => e.extensions?.userPresentableMessage ?? e.message).join('; '),
      );
    if (!body.data) throw new ToolError(`GraphQL answered ${res.status} without data`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return body.data as any;
  };
}
