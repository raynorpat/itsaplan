import { getActiveSession, provideInstanceHandlers } from '@repo/auth';
import { accountEmailsHandlers } from '../accounts/handlers';
import { requestersHandlers } from '../feedback/handlers';
import { formsHandlers } from '../forms/admin';
import { aiHandlers } from '../updates/ai';
import { portalHandlers } from '../portal/admin';
import { stopSession } from '../agents/store';
import { importsHandlers } from '../imports/handlers';
import { changeTeamOwner } from '../members/store';
import { oauthAppsHandlers } from '../oauth/apps';
import { getStorageSettings } from '../settings/storage';
import { getAppVersion } from '../settings/version';
import { HttpError, UUID_RE } from '../shared/lib';
import { workflowsHandlers } from '../workflows/handlers';

// The API's side of the better-auth instance endpoints (packages/auth
// src/instance-plugin.ts): the app version, the upload limits, the team owner change
// (team managers only), the management of the workspace's OAuth applications
// (oauth/apps.ts), of teams' workflow rules (workflows/handlers.ts) and of a person's
// extra email addresses (accounts/emails.ts) and issue imports from GitLab, Gitea and
// Forgejo (imports/handlers.ts).

async function signedInUser(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

function ownerChange(body: unknown) {
  const { teamId, userId, owner } = (body ?? {}) as Record<string, unknown>;
  if (typeof teamId !== 'string' || !UUID_RE.test(teamId))
    throw new HttpError(400, 'teamId must be a team id');
  if (typeof userId !== 'string' || !UUID_RE.test(userId))
    throw new HttpError(400, 'userId must be a user id');
  if (typeof owner !== 'boolean') throw new HttpError(400, 'owner must be true or false');
  return { teamId, userId, owner };
}

export function registerInstanceHandlers(): void {
  provideInstanceHandlers({
    version: async (headers) => {
      await signedInUser(headers);
      return { version: getAppVersion() };
    },
    uploadLimits: async (headers) => {
      await signedInUser(headers);
      return getStorageSettings();
    },
    setTeamOwner: async (headers, body) => {
      const user = await signedInUser(headers);
      const change = ownerChange(body);
      await changeTeamOwner(change.teamId, change.userId, change.owner, user);
      return change;
    },
    oauthApps: oauthAppsHandlers,
    agentSessionStop: async (headers, body) => {
      const user = await signedInUser(headers);
      const sessionId = (body as { sessionId?: unknown } | undefined)?.sessionId;
      if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId))
        throw new HttpError(400, 'sessionId must be an agent session id');
      await stopSession(sessionId, user.id);
      return { success: true };
    },
    workflows: workflowsHandlers,
    accountEmails: accountEmailsHandlers,
    imports: importsHandlers,
    requesters: requestersHandlers,
    portal: portalHandlers,
    forms: formsHandlers,
    ai: aiHandlers,
  });
}
