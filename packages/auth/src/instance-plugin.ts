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
// - GET  /instance/account/emails/confirm-info?token= and POST
//   /instance/account/emails/confirm { token }  public (the token is the credential):
//   the web's confirmation page, which the mailed link opens, reads the address, and
//   its button confirms it. Opening the link confirms nothing.
// - GET  /instance/imports, GET /instance/import?id=, GET /instance/import/people?id=
//   and POST /instance/imports/{repositories, start, process}  workspace admins and
//   owners: issue imports from GitLab, Gitea and Forgejo with a pasted access token
//   (apps/api src/imports/handlers.ts), which Linear's schema has no import for. The
//   token is used by the fetch and never stored. Same Origin rule for the POSTs.
//   GET /instance/imports/github and /instance/imports/github/repositories and POST
//   /instance/imports/github/disconnect: the GitHub Import App connection the GitHub
//   imports read through (Linear's GraphQL mutations start and process those).
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
  confirmInfo(token: unknown): Promise<{ email: string }>;
  confirm(token: unknown): Promise<{ email: string }>;
}

// Issue imports from GitLab, Gitea and Forgejo (Linear's schema imports GitHub only,
// through its GitHub Import App), and what the Import page reads that Linear's schema
// has no query for: imports, the people step, the GitHub connection and its
// repositories. Each handler checks the caller itself.
export interface ImportsHandlers {
  list(headers: Headers): Promise<object>;
  get(headers: Headers, query: Record<string, unknown>): Promise<object>;
  repositories(headers: Headers, body: unknown): Promise<object>;
  start(headers: Headers, body: unknown): Promise<object>;
  people(headers: Headers, query: Record<string, unknown>): Promise<object>;
  process(headers: Headers, body: unknown): Promise<object>;
  github(headers: Headers): Promise<object>;
  githubRepositories(headers: Headers): Promise<object>;
  githubDisconnect(headers: Headers, body: unknown): Promise<object>;
}

// The people who give feedback (Linear's ExternalUser; its schema has no mutation for
// them) and the attachment that names who gave a feedback item. Each handler checks
// the caller itself.
export interface RequestersHandlers {
  list(headers: Headers, query: Record<string, unknown>): Promise<object>;
  get(headers: Headers, query: Record<string, unknown>): Promise<object>;
  create(headers: Headers, body: unknown): Promise<object>;
  update(headers: Headers, body: unknown): Promise<object>;
  merge(headers: Headers, body: unknown): Promise<object>;
  // A member turning a person's email updates on or off.
  updates(headers: Headers, body: unknown): Promise<object>;
  feedbackAttachment(headers: Headers, body: unknown): Promise<object>;
  // "Send to requesters" on a project update: the author or an admin marks it shared.
  shareProjectUpdate(headers: Headers, body: unknown): Promise<object>;
  // The ids of a project's updates already sent to requesters.
  sharedProjectUpdates(headers: Headers, query: Record<string, unknown>): Promise<object>;
  // The number of people asking on an issue, for anyone who can see it (guests too).
  feedbackCount(headers: Headers, query: Record<string, unknown>): Promise<object>;
}

// Portal boards shown to people outside the workspace (Linear has no portal): owners
// and admins manage them; members read which boards show an issue. Each handler checks
// the caller itself.
export interface PortalHandlers {
  boards(headers: Headers): Promise<object>;
  createBoard(headers: Headers, body: unknown): Promise<object>;
  updateBoard(headers: Headers, body: unknown): Promise<object>;
  deleteBoard(headers: Headers, body: unknown): Promise<object>;
  issueBoards(headers: Headers, query: Record<string, unknown>): Promise<object>;
  // Blocks or unblocks a requester from the portal (owners and admins).
  block(headers: Headers, body: unknown): Promise<object>;
  // A member starts a portal thread on a board showing the issue.
  comment(headers: Headers, body: unknown): Promise<object>;
}

// Forms (team issue templates published to people outside the workspace): owners and
// admins read and change their publishing settings and delete them. Each handler
// checks the caller itself.
export interface FormsHandlers {
  list(headers: Headers): Promise<object>;
  saveSettings(headers: Headers, body: unknown): Promise<object>;
  deleteForm(headers: Headers, body: unknown): Promise<object>;
}

// The AI endpoint that writes requester summaries (owners and admins): read without the
// key, save, delete and test. Each handler checks the caller itself.
export interface AiHandlers {
  get(headers: Headers): Promise<object>;
  save(headers: Headers, body: unknown): Promise<object>;
  remove(headers: Headers, body: unknown): Promise<object>;
  test(headers: Headers, body: unknown): Promise<object>;
}

// Dashboards (pages of Insights widgets): owners, admins and members list, read,
// create, change, delete and duplicate them, and open the workspace feedback report.
// Each handler checks the caller itself.
export interface DashboardsHandlers {
  list(headers: Headers): Promise<object>;
  get(headers: Headers, query: Record<string, unknown>): Promise<object>;
  create(headers: Headers, body: unknown): Promise<object>;
  update(headers: Headers, body: unknown): Promise<object>;
  remove(headers: Headers, body: unknown): Promise<object>;
  duplicate(headers: Headers, body: unknown): Promise<object>;
  feedback(headers: Headers, body: unknown): Promise<object>;
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
  requesters: RequestersHandlers;
  portal: PortalHandlers;
  forms: FormsHandlers;
  ai: AiHandlers;
  dashboards: DashboardsHandlers;
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

const requestersWrite = (
  path: string,
  trusted: string[],
  call: (h: RequestersHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.requesters, headers, body));

const portalWrite = (
  path: string,
  trusted: string[],
  call: (h: PortalHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.portal, headers, body));

const formsWrite = (
  path: string,
  trusted: string[],
  call: (h: FormsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.forms, headers, body));

const aiWrite = (
  path: string,
  trusted: string[],
  call: (h: AiHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.ai, headers, body));

const dashboardsWrite = (
  path: string,
  trusted: string[],
  call: (h: DashboardsHandlers, headers: Headers, body: unknown) => Promise<object>,
) => write(path, trusted, (h, headers, body) => call(h.dashboards, headers, body));

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
      instanceRequesters: createAuthEndpoint(
        '/instance/requesters',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(
            await run((h) => h.requesters.list(ctx.headers ?? new Headers(), { ...ctx.query })),
          ),
      ),
      instanceRequester: createAuthEndpoint('/instance/requester', { method: 'GET' }, async (ctx) =>
        ctx.json(
          await run((h) => h.requesters.get(ctx.headers ?? new Headers(), { ...ctx.query })),
        ),
      ),
      instanceRequesterCreate: requestersWrite(
        '/instance/requesters/create',
        options.trustedOrigins,
        (h, headers, body) => h.create(headers, body),
      ),
      instanceRequesterUpdate: requestersWrite(
        '/instance/requesters/update',
        options.trustedOrigins,
        (h, headers, body) => h.update(headers, body),
      ),
      instanceRequesterMerge: requestersWrite(
        '/instance/requesters/merge',
        options.trustedOrigins,
        (h, headers, body) => h.merge(headers, body),
      ),
      instanceRequesterUpdates: requestersWrite(
        '/instance/requesters/updates',
        options.trustedOrigins,
        (h, headers, body) => h.updates(headers, body),
      ),
      instanceProjectUpdateShare: requestersWrite(
        '/instance/project-updates/share',
        options.trustedOrigins,
        (h, headers, body) => h.shareProjectUpdate(headers, body),
      ),
      instanceProjectUpdatesShared: createAuthEndpoint(
        '/instance/project-updates/shared',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(
            await run((h) =>
              h.requesters.sharedProjectUpdates(ctx.headers ?? new Headers(), { ...ctx.query }),
            ),
          ),
      ),
      instanceFeedbackAttachment: requestersWrite(
        '/instance/feedback/attachment',
        options.trustedOrigins,
        (h, headers, body) => h.feedbackAttachment(headers, body),
      ),
      instanceFeedbackCount: createAuthEndpoint(
        '/instance/feedback/count',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(
            await run((h) =>
              h.requesters.feedbackCount(ctx.headers ?? new Headers(), { ...ctx.query }),
            ),
          ),
      ),
      instancePortalBoards: createAuthEndpoint(
        '/instance/portal/boards',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.portal.boards(ctx.headers ?? new Headers()))),
      ),
      instancePortalBoardCreate: portalWrite(
        '/instance/portal/boards/create',
        options.trustedOrigins,
        (h, headers, body) => h.createBoard(headers, body),
      ),
      instancePortalBoardUpdate: portalWrite(
        '/instance/portal/boards/update',
        options.trustedOrigins,
        (h, headers, body) => h.updateBoard(headers, body),
      ),
      instancePortalBoardDelete: portalWrite(
        '/instance/portal/boards/delete',
        options.trustedOrigins,
        (h, headers, body) => h.deleteBoard(headers, body),
      ),
      instancePortalBlock: portalWrite(
        '/instance/portal/block',
        options.trustedOrigins,
        (h, headers, body) => h.block(headers, body),
      ),
      instancePortalComment: portalWrite(
        '/instance/portal/comment',
        options.trustedOrigins,
        (h, headers, body) => h.comment(headers, body),
      ),
      instancePortalIssueBoards: createAuthEndpoint(
        '/instance/portal/issue-boards',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(
            await run((h) => h.portal.issueBoards(ctx.headers ?? new Headers(), { ...ctx.query })),
          ),
      ),
      instanceForms: createAuthEndpoint('/instance/forms', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.forms.list(ctx.headers ?? new Headers()))),
      ),
      instanceFormSettings: formsWrite(
        '/instance/forms/settings',
        options.trustedOrigins,
        (h, headers, body) => h.saveSettings(headers, body),
      ),
      instanceFormDelete: formsWrite(
        '/instance/forms/delete',
        options.trustedOrigins,
        (h, headers, body) => h.deleteForm(headers, body),
      ),
      instanceAi: createAuthEndpoint('/instance/ai', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.ai.get(ctx.headers ?? new Headers()))),
      ),
      instanceAiSave: aiWrite('/instance/ai/save', options.trustedOrigins, (h, headers, body) =>
        h.save(headers, body),
      ),
      instanceAiDelete: aiWrite('/instance/ai/delete', options.trustedOrigins, (h, headers, body) =>
        h.remove(headers, body),
      ),
      instanceAiTest: aiWrite('/instance/ai/test', options.trustedOrigins, (h, headers, body) =>
        h.test(headers, body),
      ),
      instanceDashboards: createAuthEndpoint(
        '/instance/dashboards',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.dashboards.list(ctx.headers ?? new Headers()))),
      ),
      instanceDashboard: createAuthEndpoint('/instance/dashboard', { method: 'GET' }, async (ctx) =>
        ctx.json(
          await run((h) => h.dashboards.get(ctx.headers ?? new Headers(), { ...ctx.query })),
        ),
      ),
      instanceDashboardCreate: dashboardsWrite(
        '/instance/dashboards/create',
        options.trustedOrigins,
        (h, headers, body) => h.create(headers, body),
      ),
      instanceDashboardUpdate: dashboardsWrite(
        '/instance/dashboards/update',
        options.trustedOrigins,
        (h, headers, body) => h.update(headers, body),
      ),
      instanceDashboardDelete: dashboardsWrite(
        '/instance/dashboards/delete',
        options.trustedOrigins,
        (h, headers, body) => h.remove(headers, body),
      ),
      instanceDashboardDuplicate: dashboardsWrite(
        '/instance/dashboards/duplicate',
        options.trustedOrigins,
        (h, headers, body) => h.duplicate(headers, body),
      ),
      instanceDashboardFeedback: dashboardsWrite(
        '/instance/dashboards/feedback',
        options.trustedOrigins,
        (h, headers, body) => h.feedback(headers, body),
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
      // The confirmation page (the mailed link) reads the address, then posts the token
      // when its button is pressed. Neither needs a session: the token is the
      // credential, so the POST has no Origin check of its own.
      instanceAccountEmailConfirmInfo: createAuthEndpoint(
        '/instance/account/emails/confirm-info',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.accountEmails.confirmInfo(ctx.query?.token))),
      ),
      instanceAccountEmailConfirm: createAuthEndpoint(
        '/instance/account/emails/confirm',
        { method: 'POST' },
        async (ctx) => {
          const body = ctx.body as Record<string, unknown> | undefined;
          return ctx.json(await run((h) => h.accountEmails.confirm(body?.token)));
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
      instanceImportGithub: createAuthEndpoint(
        '/instance/imports/github',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.imports.github(ctx.headers ?? new Headers()))),
      ),
      instanceImportGithubRepositories: createAuthEndpoint(
        '/instance/imports/github/repositories',
        { method: 'GET' },
        async (ctx) =>
          ctx.json(await run((h) => h.imports.githubRepositories(ctx.headers ?? new Headers()))),
      ),
      instanceImportGithubDisconnect: importsWrite(
        '/instance/imports/github/disconnect',
        options.trustedOrigins,
        (h, headers, body) => h.githubDisconnect(headers, body),
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
