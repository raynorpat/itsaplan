import { Elysia, t } from 'elysia';
import { guards } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { ErrorResponse } from '../shared/responses';
import { getPreferences, setPreferences } from './store';

const EventToggles = t.Object({
  assigned: t.Boolean(),
  mentioned: t.Boolean(),
  commented: t.Boolean(),
  state_changed: t.Boolean(),
});

const PreferenceBody = t.Object({
  emailEvents: EventToggles,
  telegramEvents: EventToggles,
});

// A member's own notification preferences for a team: which issue events they want
// by email and/or Telegram. Every route is self-scoped to the session user, so bare
// team membership is enough (no admin gate) — a member only ever reads or writes
// their own row. The team's provider credentials are a separate, owner-only
// concern (notification-settings), and the Telegram chat to reach the member at comes
// from their linked account (/telegram/account), not from here.
export const notificationPreferenceRoutes = new Elysia({
  name: 'notification-preferences',
  detail: { tags: ['Settings'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamKey/notification-preferences',
    ({ team, user }) => getPreferences(requireUser(user).id, team.id),
    {
      teamMember: true,
      response: {
        200: PreferenceBody,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get notification preferences',
        description: "Get the current user's notification preferences for a team.",
      },
    },
  )

  .put(
    '/teams/:teamKey/notification-preferences',
    ({ team, user, body }) => setPreferences(requireUser(user).id, team.id, body),
    {
      body: PreferenceBody,
      teamMember: true,
      response: {
        200: PreferenceBody,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update notification preferences',
        description: "Update the current user's notification preferences for a team.",
      },
    },
  );
