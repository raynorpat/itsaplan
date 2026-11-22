import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { getPreferences, isValidTimezone, updatePreferences } from './store';

const PreferenceResponse = t.Object({ timezone: t.String() });

const PreferencePatch = t.Object({
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
});

// The session user's time zone. The other interface preferences are kept in the
// browser. Every route is self-scoped to the session user, so no team guard applies
// — a user only ever reads or writes their own row. Not MCP tools: an agent has no
// business changing a person's UI settings.
export const userPreferenceRoutes = new Elysia({
  name: 'user-preferences',
  detail: { tags: ['Settings'] },
})
  .use(authContext)

  .get('/account/preferences', ({ user }) => getPreferences(requireUser(user).id), {
    response: { 200: PreferenceResponse, 401: ErrorResponse },
    detail: {
      summary: 'Get account preferences',
      description: "Get the current user's time zone. Returns UTC when none was saved.",
    },
  })

  .patch(
    '/account/preferences',
    async ({ user, body }) => {
      const current = requireUser(user);
      if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
        throw new HttpError(400, 'Unknown timezone');
      }
      return updatePreferences(current.id, body);
    },
    {
      body: PreferencePatch,
      response: {
        200: PreferenceResponse,
        400: ErrorResponse,
        401: ErrorResponse,
      },
      detail: {
        summary: 'Update account preferences',
        description: "Update the current user's time zone.",
      },
    },
  );
