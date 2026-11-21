import { createYoga } from 'graphql-yoga';
import type { SessionUser } from '../shared/auth-context';
import { resolveGraphQLUser, type GraphQLContext } from './context';
import { buildSchema } from './schema';
import { organizationResolvers } from './resolvers/organization';
import { teamResolvers } from './resolvers/team';
import { userResolvers } from './resolvers/user';
import { workflowStateResolvers } from './resolvers/workflow-state';

// Each resolver module contributes Query / Mutation / type maps; merged per key.
const resolverModules: Record<string, Record<string, unknown>>[] = [
  organizationResolvers,
  userResolvers,
  teamResolvers,
  workflowStateResolvers,
];

function mergeResolvers(modules: Record<string, Record<string, unknown>>[]) {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const mod of modules)
    for (const [type, fields] of Object.entries(mod)) merged[type] = { ...merged[type], ...fields };
  return merged;
}

const AUTH_MESSAGE = 'Authentication required, not authenticated';

// Adds the Linear-compatible GraphQL endpoint (/graphql) to the app. Mounted on the
// root app after the chain, like the MCP endpoint, so `type App` stays the REST
// surface. Authentication is resolved before Yoga runs: a request without valid
// credentials gets a 401 with Linear's AUTHENTICATION_ERROR shape.
// Typed as `any` for the same reason as mountMcp: Elysia's generics are invariant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountGraphql(app: any): void {
  const yoga = createYoga<{ user: SessionUser }, GraphQLContext>({
    schema: buildSchema(mergeResolvers(resolverModules)),
    graphqlEndpoint: '/graphql',
    graphiql: false,
    landingPage: false,
    context: ({ user }) => ({ user }),
  });

  app.all(
    '/graphql',
    async ({ request }: { request: Request }) => {
      const user = await resolveGraphQLUser(request);
      if (!user)
        return Response.json(
          {
            errors: [
              {
                message: AUTH_MESSAGE,
                extensions: { code: 'AUTHENTICATION_ERROR', userPresentableMessage: AUTH_MESSAGE },
              },
            ],
          },
          { status: 401 },
        );
      return yoga.fetch(request, { user });
    },
    // Yoga reads the raw request body itself.
    { parse: 'none', detail: { hide: true } },
  );
}
