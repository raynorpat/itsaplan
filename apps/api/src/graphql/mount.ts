import { createYoga, maskError, type Plugin } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { PG_INVALID_INPUT_CODES, pgErrorCode } from '../shared/lib';
import type { SessionUser } from './context';
import { resolveGraphQLAuth, type GraphQLContext } from './context';
import { scopeCheck } from './scopes';
import { runWithAuth, type RequestAuth } from '../shared/request-auth';
import { isAnonymousRequest } from './anonymous';
import { buildSchema } from './schema';
import { maxDepthRule } from './depth';
import { gqlError } from './errors';
import { issueResolvers } from './resolvers/issue';
import { mutationResolvers } from './resolvers/mutations';
import { projectResolvers } from './resolvers/project';
import { projectMutationResolvers } from './resolvers/project-mutations';
import { webhookResolvers } from './resolvers/webhook';
import { commentResolvers } from './resolvers/comment';
import { reactionResolvers } from './resolvers/reaction';
import { issueLabelResolvers } from './resolvers/issue-label';
import { cycleResolvers } from './resolvers/cycle';
import { issueRelationResolvers } from './resolvers/issue-relation';
import { documentResolvers } from './resolvers/document';
import { attachmentResolvers } from './resolvers/attachment';
import { notificationResolvers } from './resolvers/notification';
import { userSettingsResolvers } from './resolvers/user-settings';
import { inviteDetailsResolvers } from './resolvers/invite-details';
import { uploadResolvers } from './resolvers/upload';
import { customViewResolvers } from './resolvers/custom-view';
import { issueSubscriptionResolvers } from './resolvers/issue-subscription';
import { historyResolvers } from './resolvers/history';
import { initiativeResolvers } from './resolvers/initiative';
import { initiativeMutationResolvers } from './resolvers/initiative-mutations';
import { organizationResolvers } from './resolvers/organization';
import { teamResolvers } from './resolvers/team';
import { userResolvers } from './resolvers/user';
import { workflowStateResolvers } from './resolvers/workflow-state';
import { workspaceResolvers } from './resolvers/workspace';
import { agentResolvers } from './resolvers/agent';
import { issueImportResolvers } from './resolvers/issue-import';

// Each resolver module contributes Query / Mutation / type maps; merged per key.
const resolverModules: Record<string, Record<string, unknown>>[] = [
  organizationResolvers,
  userResolvers,
  teamResolvers,
  workflowStateResolvers,
  issueResolvers,
  projectResolvers,
  mutationResolvers,
  projectMutationResolvers,
  webhookResolvers,
  commentResolvers,
  reactionResolvers,
  issueLabelResolvers,
  cycleResolvers,
  issueRelationResolvers,
  documentResolvers,
  attachmentResolvers,
  notificationResolvers,
  userSettingsResolvers,
  inviteDetailsResolvers,
  uploadResolvers,
  customViewResolvers,
  issueSubscriptionResolvers,
  historyResolvers,
  initiativeResolvers,
  initiativeMutationResolvers,
  workspaceResolvers,
  agentResolvers,
  issueImportResolvers,
];

function mergeResolvers(modules: Record<string, Record<string, unknown>>[]) {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const mod of modules)
    for (const [type, fields] of Object.entries(mod)) merged[type] = { ...merged[type], ...fields };
  return merged;
}

// Adds maxDepthRule to Yoga's validation (Yoga takes rules through a plugin hook).
const depthLimit: Plugin = {
  onValidate: ({ addValidationRule }) => addValidationRule(maxDepthRule),
};

const AUTH_MESSAGE = 'Authentication required, not authenticated';

// Adds the Linear-compatible GraphQL endpoint (/graphql) to the app. Mounted on the
// root app after the chain, like the MCP endpoint. Authentication is resolved before
// Yoga runs: a request without valid
// credentials gets a 401 with Linear's AUTHENTICATION_ERROR shape, except the invite
// lookup (anonymous.ts).
// Typed as `any` for the same reason as mountMcp: Elysia's generics are invariant.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountGraphql(app: any): void {
  const yoga = createYoga<{ user: SessionUser; auth: RequestAuth }, GraphQLContext>({
    schema: buildSchema(mergeResolvers(resolverModules)),
    graphqlEndpoint: '/graphql',
    graphiql: false,
    landingPage: false,
    context: ({ user, auth }) => ({ user, auth }),
    plugins: [depthLimit, scopeCheck],
    maskedErrors: {
      // A value Postgres cannot store or read (bad uuid/date/number text, a value
      // out of range, a violated check) is the client's error, not an internal one.
      maskError(error, message, isDev) {
        const cause = error instanceof GraphQLError ? error.originalError : error;
        const code = pgErrorCode(cause);
        if (code && PG_INVALID_INPUT_CODES.has(code))
          return gqlError('INVALID_INPUT', 'Invalid input');
        if (code === '23505') return gqlError('CONFLICT', 'A conflicting record already exists');
        return maskError(error, message, isDev);
      },
    },
  });

  app.all(
    '/graphql',
    async ({ request }: { request: Request }) => {
      // Only JSON bodies: a form-encoded or text POST is what a cross-site HTML form
      // can send with the session cookie, so refusing it closes that CSRF path.
      if (request.method === 'POST' && !request.headers.get('content-type')?.includes('json'))
        return Response.json(
          { errors: [{ message: 'POST requests must use Content-Type: application/json' }] },
          { status: 415 },
        );
      const resolved = await resolveGraphQLAuth(request);
      // Without credentials only the invite lookup is answered; its resolver does not
      // read the user.
      if (!resolved && (await isAnonymousRequest(request)))
        return yoga.fetch(request, {
          user: null as unknown as SessionUser,
          auth: null as unknown as RequestAuth,
        });
      if (!resolved)
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
      // The request's credentials stay readable for the whole execution (the role
      // checks apply an OAuth token's scopes, shared/request-auth.ts).
      return runWithAuth(resolved.auth, () => yoga.fetch(request, resolved));
    },
    // Yoga reads the raw request body itself.
    { parse: 'none', detail: { hide: true } },
  );
}
