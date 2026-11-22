import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { getMembership } from '../members/store';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import { HotkeyCombosSchema } from '../settings/hotkeys';
import { getPreferences, isValidTimezone, updatePreferences } from './store';

const Theme = t.Union([t.Literal('light'), t.Literal('dark'), t.Literal('system')]);
const IssueOpenMode = t.Union([t.Literal('panel'), t.Literal('page')]);
const StartPage = t.Union([t.Literal('inbox'), t.Literal('work-items'), t.Literal('projects')]);

const IssueStatsView = t.Union([t.Literal('compact'), t.Literal('timeline')]);

const PreferenceResponse = t.Object({
  timezone: t.String(),
  theme: Theme,
  issueOpenMode: IssueOpenMode,
  startPage: StartPage,
  issueStatsOpen: t.Boolean(),
  issueStatsView: IssueStatsView,
  lastTeamId: t.Nullable(t.String({ format: 'uuid' })),
  hotkeys: HotkeyCombosSchema,
});

const PreferencePatch = t.Object({
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
  theme: t.Optional(Theme),
  issueOpenMode: t.Optional(IssueOpenMode),
  startPage: t.Optional(StartPage),
  issueStatsOpen: t.Optional(t.Boolean()),
  issueStatsView: t.Optional(IssueStatsView),
  lastTeamId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
  // The full set of the user's overrides: a shortcut left out falls back to the
  // instance binding.
  hotkeys: t.Optional(HotkeyCombosSchema),
});

// The session user's own interface preferences: timezone, theme, how a clicked issue
// opens, which section the app root lands on, whether the floating AI chat starts
// visible, how an issue's status stats section starts out, and the team they were
// in last. Every route is self-scoped to the session user, so no team guard applies
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
      description:
        "Get the current user's interface preferences. Returns the defaults when none were saved.",
    },
  })

  .patch(
    '/account/preferences',
    async ({ user, body }) => {
      const current = requireUser(user);
      if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
        throw new HttpError(400, 'Unknown timezone');
      }
      // Only a team the user belongs to can be remembered, so the stored id can
      // never point at one they cannot open.
      if (body.lastTeamId != null && !(await getMembership(body.lastTeamId, current.id))) {
        throw new HttpError(403, 'You do not have access to this team');
      }
      return updatePreferences(current.id, body);
    },
    {
      body: PreferencePatch,
      response: {
        200: PreferenceResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
      },
      detail: {
        summary: 'Update account preferences',
        description:
          "Update the current user's interface preferences. Omitted fields keep their current value.",
      },
    },
  );
