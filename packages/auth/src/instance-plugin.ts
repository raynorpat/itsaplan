import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { signInOptions } from './instance';
import { authorizedApplications, consentClient, revokeAuthorization } from './oauth-authorized';
import { isWorkspaceAdmin, uninstallApplication } from './oauth-install';

// Instance information that Linear's GraphQL schema has no place for, served by
// better-auth under /api/auth/instance/*:
//
// - GET  /instance/sign-in-options  public: { emailEnabled, google, passkey }
// - GET  /instance/version          signed in: { version }
// - GET  /instance/upload-limits    signed in: the upload limits
// - POST /instance/team-owner       team managers: { teamId, userId, owner } makes a
//   team member a team owner or a plain member, answering the same body. With a
//   session cookie the request's Origin must be one of the app's origins.
// - POST /instance/oauth-uninstall  workspace admins and owners: { clientId }
//   uninstalls an OAuth application (oauth-install.ts): its tokens, consents and
//   pending codes are deleted and its app user is suspended. Same Origin rule.
// - GET  /instance/oauth-apps and POST /instance/oauth-apps/{create, update,
//   rotate-secret, rotate-webhook-secret, archive}  workspace admins and owners: the
//   workspace's OAuth applications (apps/api src/oauth/apps.ts). Secrets are in the
//   answers of create and the rotations only. Same Origin rule for the POSTs.
// - GET  /instance/oauth-client?clientId=  signed in: the application a consent page
//   shows (name, description, developer, icon); 404 for an unknown or archived one.
// - GET  /instance/oauth-authorized and POST /instance/oauth-authorized/revoke
//   { clientId }  signed in: the applications the person has authorized to act as
//   themselves, and revoking one (oauth-authorized.ts). Same Origin rule.
// - GET  /instance/workflows?teamId=&includeArchived=true, GET /instance/workflow?id=
//   and POST /instance/workflows/{create, update, enable, reorder, archive, unarchive,
//   delete}  signed in: a team's automation rules (Linear's WorkflowDefinition, whose
//   management Linear's schema does not include; apps/api src/workflows). Who may list
//   and change them is the API's rule. Same Origin rule for the POSTs.
// - POST /instance/agent-session-stop { sessionId }  signed in: stops an agent session
//   the person can see (Linear's stop signal; the schema lets no API client send it).
//   Same Origin rule.
//
// - GET  /instance/account/emails and POST /instance/account/emails/{add, remove}
//   signed in: the person's extra email addresses, used only to match people in an
//   issue import (apps/api src/accounts/emails.ts). Same Origin rule for the POSTs.
// - GET  /instance/account/emails/confirm?token=  public: the link mailed to an added
//   address; confirms it and redirects to the web's profile page with
//   `emailConfirmed=1` or `emailConfirmError=<message>`.
// - GET  /instance/imports, GET /instance/import?id=, GET /instance/import/people?id=
//   and POST /instance/imports/{repositories, start, process}  workspace admins and
//   owners: issue imports from GitLab, Gitea and Forgejo with a pasted access token
//   (apps/api src/imports/handlers.ts), which Linear's schema has no import for. The
//   token is used by the fetch and never stored. Same Origin rule for the POSTs.
//
// Linear's schema exposes TeamMembership.owner but no input that sets it, and the
// vendored schema is never edited, so the owner change lives here too.
//
// The version, the upload limits and the owner change need the API's own session and
// access rules (apps/api), which this package cannot import (the dependency graph is
// api → auth → db). The API registers them at startup with provideInstanceHandlers.
// A handler signals a refusal by throwing an error with an HTTP `status`.

export interface TeamOwnerChange {
  teamId: string;
  userId: string;
  owner: boolean;
}

// The workspace's OAuth applications, managed by its admins and owners. Each handler
// checks the caller itself.
export interface OAuthAppsHandlers {
  list(headers: Headers): Promise<object>;
  create(headers: Headers, body: unknown): Promise<object>;
  update(headers: Headers, body: unknown): Promise<object>;
  rotateSecret(headers: Headers, body: unknown): Promise<object>;
  rotateWebhookSecret(headers: Headers, body: unknown): Promise<object>;
  archive(headers: Headers, body: unknown): Promise<object>;
}

// A team's workflow automation rules. Each handler checks the caller itself.
export interface WorkflowsHandlers {
  list(headers: Headers, query: Record<string, unknown>): Promise<object>;
  get(headers: Headers, query: Record<string, unknown>): Promise<object>;
  create(headers: Headers, body: unknown): Promise<object>;
  update(headers: Headers, body: unknown): Promise<object>;
  enable(headers: Headers, body: unknown): Promise<object>;
  reorder(headers: Headers, body: unknown): Promise<object>;
  archive(headers: Headers, body: unknown): Promise<object>;
  unarchive(headers: Headers, body: unknown): Promise<object>;
  delete(headers: Headers, body: unknown): Promise<object>;
}

// A person's extra email addresses. Each handler checks the caller itself; confirm
// takes the link's token, which is its only credential.
export interface AccountEmailsHandlers {
  list(headers: Headers): Promise<object>;
  add(headers: Headers, body: unknown): Promise<object>;
  remove(headers: Headers, body: unknown): Promise<object>;
  confirm(token: unknown): Promise<{ email: string }>;
}

// Issue imports from GitLab, Gitea and Forgejo (Linear's schema imports GitHub only,
// through its GitHub Import App). Each handler checks the caller itself.
export interface ImportsHandlers {
  list(headers: Headers): Promise<object>;
  get(headers: Headers, query: Record<string, unknown>): Promise<object>;
  repositories(headers: Headers, body: unknown): Promise<object>;
  start(headers: Headers, body: unknown): Promise<object>;
  people(headers: Headers, query: Record<string, unknown>): Promise<object>;
  process(headers: Headers, body: unknown): Promise<object>;
}

export interface InstanceHandlers {
  version(headers: Headers): Promise<{ version: string }>;
  uploadLimits(headers: Headers): Promise<object>;
  setTeamOwner(headers: Headers, body: unknown): Promise<TeamOwnerChange>;
  oauthApps: OAuthAppsHandlers;
  agentSessionStop(headers: Headers, body: unknown): Promise<{ success: boolean }>;
  workflows: WorkflowsHandlers;
  accountEmails: AccountEmailsHandlers;
  imports: ImportsHandlers;
}

let handlers: InstanceHandlers | null = null;

export function provideInstanceHandlers(provided: InstanceHandlers): void {
  handlers = provided;
}

// Runs a registered handler, turning an error with an HTTP `status` into better-auth's
// error of that status and message. Anything else is an unexpected failure (500).
async function run<T>(call: (h: InstanceHandlers) => Promise<T>): Promise<T> {
  if (!handlers) throw new Error('Instance handlers are not registered');
  try {
    return await call(handlers);
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 600)
      throw new APIError(status as ConstructorParameters<typeof APIError>[0], {
        message: (err as Error).message,
      });
    throw err;
  }
}

// A write authenticated by the session cookie must come from a trusted origin, so
// another site cannot make a signed-in browser change a team owner (CSRF). better-auth
// does not check the request origin on plugin endpoints. A request without a cookie
// (an API key) carries no ambient credential and is not checked.
function assertTrustedOrigin(headers: Headers | undefined, trusted: string[]): void {
  if (!headers?.get('cookie')) return;
  const origin = headers.get('origin');
  if (!origin || !trusted.includes(origin))
    throw new APIError('FORBIDDEN', { message: 'This request must come from the app' });
}

// A cookie-checked POST that runs one of the registered handlers.
const write = (
  path: string,
  trusted: string[],
  call: (h: InstanceHandlers, headers: Headers, body: unknown) => Promise<object>,
) =>
  createAuthEndpoint(path, { method: 'POST' }, async (ctx) => {
    assertTrustedOrigin(ctx.headers, trusted);
    return ctx.json(await run((h) => call(h, ctx.headers ?? new Headers(), ctx.body)));
  });

const oauthAppsWrite = (
  path: string,
  trusted: string[],
  call: (h: OAuthAppsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.oauthApps, headers, body));

const workflowsWrite = (
  path: string,
  trusted: string[],
  call: (h: WorkflowsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.workflows, headers, body));

const accountEmailsWrite = (
  path: string,
  trusted: string[],
  call: (h: AccountEmailsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.accountEmails, headers, body));

const importsWrite = (
  path: string,
  trusted: string[],
  call: (h: ImportsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.imports, headers, body));

const requiredClientId = (body: unknown): string => {
  const clientId = (body as { clientId?: unknown } | undefined)?.clientId;
  if (typeof clientId !== 'string' || !clientId)
    throw new APIError('BAD_REQUEST', { message: 'clientId is required' });
  return clientId;
};

export const instancePlugin = (options: { trustedOrigins: string[] }) =>
  ({
    id: 'instance',
    endpoints: {
      instanceSignInOptions: createAuthEndpoint(
        '/instance/sign-in-options',
        { method: 'GET' },
        async (ctx) => ctx.json(await signInOptions()),
      ),
      instanceVersion: createAuthEndpoint('/instance/version', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.version(ctx.headers ?? new Headers()))),
      ),
      instanceUploadLimits: createAuthEndpoint(
        '/instance/upload-limits',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.uploadLimits(ctx.headers ?? new Headers()))),
      ),
      instanceTeamOwner: createAuthEndpoint(
        '/instance/team-owner',
        { method: 'POST' },
        async (ctx) => {
          assertTrustedOrigin(ctx.headers, options.trustedOrigins);
          return ctx.json(await run((h) => h.setTeamOwner(ctx.headers ?? new Headers(), ctx.body)));
        },
      ),
      instanceAgentSessionStop: createAuthEndpoint(
        '/instance/agent-session-stop',
        { method: 'POST' },
        async (ctx) => {
          assertTrustedOrigin(ctx.headers, options.trustedOrigins);
          return ctx.json(
            await run((h) => h.agentSessionStop(ctx.headers ?? new Headers(), ctx.body)),
          );
        },
      ),
      instanceWorkflows: createAuthEndpoint('/instance/workflows', { method: 'GET' }, async (ctx) =>
        ctx.json(
          await run((h) => h.workflows.list(ctx.headers ?? new Headers(), { ...ctx.query })),
        ),
      ),
      instanceWorkflow: createAuthEndpoint('/instance/workflow', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.workflows.get(ctx.headers ?? new Headers(), { ...ctx.query }))),
      ),
      instanceWorkflowCreate: workflowsWrite(
        '/instance/workflows/create',
        options.trustedOrigins,
        (h, headers, body) => h.create(headers, body),
      ),
      instanceWorkflowUpdate: workflowsWrite(
        '/instance/workflows/update',
        options.trustedOrigins,
        (h, headers, body) => h.update(headers, body),
      ),
      instanceWorkflowEnable: workflowsWrite(
        '/instance/workflows/enable',
        options.trustedOrigins,
        (h, headers, body) => h.enable(headers, body),
      ),
      instanceWorkflowReorder: workflowsWrite(
        '/instance/workflows/reorder',
        options.trustedOrigins,
        (h, headers, body) => h.reorder(headers, body),
      ),
      instanceWorkflowArchive: workflowsWrite(
        '/instance/workflows/archive',
        options.trustedOrigins,
        (h, headers, body) => h.archive(headers, body),
      ),
      instanceWorkflowUnarchive: workflowsWrite(
        '/instance/workflows/unarchive',
        options.trustedOrigins,
        (h, headers, body) => h.unarchive(headers, body),
      ),
      instanceWorkflowDelete: workflowsWrite(
        '/instance/workflows/delete',
        options.trustedOrigins,
        (h, headers, body) => h.delete(headers, body),
      ),
      instanceAccountEmails: createAuthEndpoint(
        '/instance/account/emails',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(await run((h) => h.accountEmails.list(ctx.headers ?? new Headers()))),
      ),
      instanceAccountEmailAdd: accountEmailsWrite(
        '/instance/account/emails/add',
        options.trustedOrigins,
        (h, headers, body) => h.add(headers, body),
      ),
      instanceAccountEmailRemove: accountEmailsWrite(
        '/instance/account/emails/remove',
        options.trustedOrigins,
        (h, headers, body) => h.remove(headers, body),
      ),
      instanceAccountEmailConfirm: createAuthEndpoint(
        '/instance/account/emails/confirm',
        { method: 'GET' },
        async (ctx) => {
          const profile = `${options.trustedOrigins[0]}/settings/account/profile`;
          try {
            await run((h) => h.accountEmails.confirm(ctx.query?.token));
          } catch (err) {
            const message = err instanceof APIError ? err.message : 'The link could not be used';
            throw ctx.redirect(`${profile}?emailConfirmError=${encodeURIComponent(message)}`);
          }
          throw ctx.redirect(`${profile}?emailConfirmed=1`);
        },
      ),
      instanceImports: createAuthEndpoint('/instance/imports', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.imports.list(ctx.headers ?? new Headers()))),
      ),
      instanceImport: createAuthEndpoint('/instance/import', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.imports.get(ctx.headers ?? new Headers(), { ...ctx.query }))),
      ),
      instanceImportPeople: createAuthEndpoint(
        '/instance/import/people',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(
            await run((h) => h.imports.people(ctx.headers ?? new Headers(), { ...ctx.query })),
          ),
      ),
      instanceImportRepositories: importsWrite(
        '/instance/imports/repositories',
        options.trustedOrigins,
        (h, headers, body) => h.repositories(headers, body),
      ),
      instanceImportStart: importsWrite(
        '/instance/imports/start',
        options.trustedOrigins,
        (h, headers, body) => h.start(headers, body),
      ),
      instanceImportProcess: importsWrite(
        '/instance/imports/process',
        options.trustedOrigins,
        (h, headers, body) => h.process(headers, body),
      ),
      instanceOAuthUninstall: createAuthEndpoint(
        '/instance/oauth-uninstall',
        { method: 'POST' },
        async (ctx) => {
          assertTrustedOrigin(ctx.headers, options.trustedOrigins);
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Authentication required' });
          if (!(await isWorkspaceAdmin(session.user.id)))
            throw new APIError('FORBIDDEN', {
              message: 'Only a workspace admin or owner can uninstall an application',
            });
          if (!(await uninstallApplication(requiredClientId(ctx.body))))
            throw new APIError('NOT_FOUND', { message: 'Application not found' });
          return ctx.json({ success: true });
        },
      ),
      instanceOAuthApps: createAuthEndpoint(
        '/instance/oauth-apps',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.oauthApps.list(ctx.headers ?? new Headers()))),
      ),
      instanceOAuthAppCreate: oauthAppsWrite(
        '/instance/oauth-apps/create',
        options.trustedOrigins,
        (h, headers, body) => h.create(headers, body),
      ),
      instanceOAuthAppUpdate: oauthAppsWrite(
        '/instance/oauth-apps/update',
        options.trustedOrigins,
        (h, headers, body) => h.update(headers, body),
      ),
      instanceOAuthAppRotateSecret: oauthAppsWrite(
        '/instance/oauth-apps/rotate-secret',
        options.trustedOrigins,
        (h, headers, body) => h.rotateSecret(headers, body),
      ),
      instanceOAuthAppRotateWebhookSecret: oauthAppsWrite(
        '/instance/oauth-apps/rotate-webhook-secret',
        options.trustedOrigins,
        (h, headers, body) => h.rotateWebhookSecret(headers, body),
      ),
      instanceOAuthAppArchive: oauthAppsWrite(
        '/instance/oauth-apps/archive',
        options.trustedOrigins,
        (h, headers, body) => h.archive(headers, body),
      ),
      instanceOAuthClient: createAuthEndpoint(
        '/instance/oauth-client',
        { method: 'GET' },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Authentication required' });
          const clientId = ctx.query?.clientId;
          const client = typeof clientId === 'string' ? await consentClient(clientId) : null;
          if (!client) throw new APIError('NOT_FOUND', { message: 'Application not found' });
          return ctx.json(client);
        },
      ),
      instanceOAuthAuthorized: createAuthEndpoint(
        '/instance/oauth-authorized',
        { method: 'GET' },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Authentication required' });
          return ctx.json({ applications: await authorizedApplications(session.user.id) });
        },
      ),
      instanceOAuthAuthorizedRevoke: createAuthEndpoint(
        '/instance/oauth-authorized/revoke',
        { method: 'POST' },
        async (ctx) => {
          assertTrustedOrigin(ctx.headers, options.trustedOrigins);
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError('UNAUTHORIZED', { message: 'Authentication required' });
          await revokeAuthorization(session.user.id, requiredClientId(ctx.body));
          return ctx.json({ success: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
