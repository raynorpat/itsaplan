import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { ErrorResponse } from '../shared/responses';
import { getEmailCategories, setEmailCategories } from './store';

// Email on or off per Linear notification category.
const EmailCategories = t.Object({
  assignments: t.Boolean(),
  mentions: t.Boolean(),
  commentsAndReplies: t.Boolean(),
  statusChanges: t.Boolean(),
});

const PreferenceBody = t.Object({ emailCategories: EmailCategories });

const PreferencePatch = t.Object({ emailCategories: t.Partial(EmailCategories) });

// The session user's own email notification preferences for the whole workspace
// (Linear's notificationCategoryPreferences, email channel).
export const notificationPreferenceRoutes = new Elysia({
  name: 'notification-preferences',
  detail: { tags: ['Settings'] },
})
  .use(authContext)

  .get(
    '/account/notification-preferences',
    async ({ user }) => ({ emailCategories: await getEmailCategories(requireUser(user).id) }),
    {
      response: { 200: PreferenceBody, 401: ErrorResponse },
      detail: {
        summary: 'Get notification preferences',
        description: "Get the current user's email notification preferences per category.",
      },
    },
  )

  .patch(
    '/account/notification-preferences',
    async ({ user, body }) => ({
      emailCategories: await setEmailCategories(requireUser(user).id, body.emailCategories),
    }),
    {
      body: PreferencePatch,
      response: { 200: PreferenceBody, 400: ErrorResponse, 401: ErrorResponse },
      detail: {
        summary: 'Update notification preferences',
        description: "Change the current user's email notification preferences per category.",
      },
    },
  );
