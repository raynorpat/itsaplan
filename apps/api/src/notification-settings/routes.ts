import { Elysia, t } from 'elysia';
import { guards } from '../shared/guards';
import { authContext } from '../shared/auth-context';
import { ErrorResponse } from '../shared/responses';
import { getTeamEmailConfig } from '@repo/auth';
import {
  ENCRYPTION_MODES,
  getNotificationSettings,
  setNotificationSettings,
  type NotificationSettingsDto,
} from './store';

const encryption = t.UnionEnum([...ENCRYPTION_MODES]);

// The redacted settings DTO (NotificationSettingsDto): the team's provider
// credentials. Secrets are never returned; each is replaced by a boolean telling
// whether a value is stored.
const NotificationSettingsResponse = t.Object({
  // Deliver email through the instance provider instead of the team's own.
  system: t.Object({ enabled: t.Boolean() }),
  // Whether that instance provider exists and is shared with teams right now.
  // The team cannot see or change it, so the UI states why sending is off.
  systemAvailable: t.Boolean(),
  smtp: t.Object({
    enabled: t.Boolean(),
    host: t.String(),
    port: t.Nullable(t.Number()),
    encryption,
    username: t.String(),
    hasPassword: t.Boolean(),
    timeout: t.Nullable(t.Number()),
  }),
  resend: t.Object({ enabled: t.Boolean(), hasApiKey: t.Boolean() }),
  telegram: t.Object({ enabled: t.Boolean(), hasBotToken: t.Boolean() }),
});

// The write body: every section optional so each provider card can save on its own.
// Secret fields are optional and, when omitted or empty, keep their stored value.
const NotificationSettingsBody = t.Object({
  system: t.Optional(t.Object({ enabled: t.Boolean() })),
  smtp: t.Optional(
    t.Object({
      enabled: t.Boolean(),
      host: t.String(),
      port: t.Nullable(t.Integer({ minimum: 1, maximum: 65535 })),
      encryption,
      username: t.String(),
      password: t.Optional(t.String()),
      timeout: t.Nullable(t.Integer({ minimum: 1 })),
    }),
  ),
  resend: t.Optional(t.Object({ enabled: t.Boolean(), apiKey: t.Optional(t.String()) })),
  telegram: t.Optional(t.Object({ enabled: t.Boolean(), botToken: t.Optional(t.String()) })),
});

// Adds whether the instance provider is available to teams right now. It is an
// instance setting, so it is reported alongside the team's own settings rather
// than stored with them.
async function withSystemAvailability(settings: NotificationSettingsDto) {
  return { ...settings, systemAvailable: (await getTeamEmailConfig()) !== null };
}

// Notification provider credentials carry secrets (SMTP password, Resend key,
// Telegram bot token), so they are managed only through the session UI and not
// exposed as MCP tools. Gated under the danger_zone resource, the team-level
// settings gate. A member's own delivery preferences live in notification-preferences.
export const notificationSettingsRoutes = new Elysia({
  name: 'notification-settings',
  detail: { tags: ['Settings'] },
})
  .use(authContext)
  .use(guards)

  .get(
    '/teams/:teamKey/notification-settings',
    async ({ team }) => withSystemAvailability(await getNotificationSettings(team.id)),
    {
      permission: ['danger_zone', 'read'],
      response: {
        200: NotificationSettingsResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Get notification provider settings',
        description: "Get a team's notification provider settings (secrets redacted).",
      },
    },
  )

  .put(
    '/teams/:teamKey/notification-settings',
    async ({ team, body }) => withSystemAvailability(await setNotificationSettings(team.id, body)),
    {
      body: NotificationSettingsBody,
      permission: ['danger_zone', 'edit'],
      response: {
        200: NotificationSettingsResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Update notification provider settings',
        description: "Update a team's notification provider settings.",
      },
    },
  );
