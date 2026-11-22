import { Elysia } from 'elysia';
import { HttpError, pgErrorCode, PG_INVALID_INPUT_CODES } from './shared/lib';
import { authContext } from './shared/auth-context';
import { teamRoutes } from './teams/routes';
import { memberRoutes } from './members/routes';
import { inviteRoutes } from './invites/routes';
import { stateRoutes } from './states/routes';
import { labelRoutes } from './labels/routes';
import { issueRoutes } from './issues/routes';
import { projectRoutes } from './projects/routes';
import { projectLabelRoutes } from './project-labels/routes';
import { attachmentRoutes } from './attachments/routes';
import { avatarRoutes } from './avatars/routes';
import { viewRoutes } from './views/routes';
import { webhookRoutes } from './webhooks/routes';
import { settingsRoutes } from './settings/routes';
import { godRoutes } from './god/routes';
import { notificationRoutes } from './notifications/routes';
import { notificationPreferenceRoutes } from './notification-preferences/routes';
import { userPreferenceRoutes } from './user-preferences/routes';

// The planner API: teams and their states, labels, issues, projects, attachments,
// saved views, webhooks and notifications. Mounted on the main app in ./app.ts.
//
// Every route requires a better-auth session (the shared authContext plugin each
// feature uses); the only exception is the public raw attachment route. The web
// client sends the session cookie with `credentials: "include"`.
//
// Errors are normalized to a { error } JSON body: HttpError carries its own
// status; a Postgres unique_violation becomes 409; request-body validation
// failures become 400; anything else is a 500 with the error logged.
export const planner = new Elysia({ name: 'planner' })
  .use(authContext)
  .onError({ as: 'global' }, ({ code, error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
    if (code === 'VALIDATION') {
      set.status = 400;
      // The validator's first message is enough for the UI; the full report is
      // large JSON that the client would just show verbatim.
      const first = (error as { all?: { summary?: string }[] }).all?.[0]?.summary;
      return { error: first ?? 'Invalid request body' };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    if (pgErrorCode(error) === '23505') {
      set.status = 409;
      return { error: 'A record with this name already exists.' };
    }
    if (PG_INVALID_INPUT_CODES.has(pgErrorCode(error) ?? '')) {
      set.status = 400;
      return { error: 'Invalid input' };
    }
    console.error('[planner] unhandled error:', error);
    set.status = 500;
    return { error: error instanceof Error ? error.message : 'Internal server error' };
  })
  .use(teamRoutes)
  .use(memberRoutes)
  .use(inviteRoutes)
  .use(stateRoutes)
  .use(labelRoutes)
  .use(issueRoutes)
  .use(projectRoutes)
  .use(projectLabelRoutes)
  .use(attachmentRoutes)
  .use(avatarRoutes)
  .use(viewRoutes)
  .use(webhookRoutes)
  .use(notificationRoutes)
  .use(notificationPreferenceRoutes)
  .use(userPreferenceRoutes)
  .use(settingsRoutes)
  .use(godRoutes);
