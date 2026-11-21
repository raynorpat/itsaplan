import { Elysia, t } from 'elysia';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { ErrorResponse } from '../shared/responses';
import {
  listNotifications,
  notificationsRev,
  unreadCount,
  setNotificationRead,
  markAllRead,
  snoozeNotification,
  deleteNotification,
  deleteNotifications,
  type NotificationType,
  type NotificationFilters,
  type DeleteScope,
} from './store';

const NOTIFICATION_TYPES: NotificationType[] = [
  'assigned',
  'mentioned',
  'commented',
  'state_changed',
];

const NotificationResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  type: t.String(),
  actorUserId: t.Nullable(t.String({ format: 'uuid' })),
  actorName: t.Nullable(t.String()),
  readAt: t.Nullable(t.String()),
  snoozedUntil: t.Nullable(t.String()),
  createdAt: t.String(),
  issueId: t.String({ format: 'uuid' }),
  issueSeq: t.Number(),
  issueTitle: t.String(),
  issueStateType: t.String(),
  teamId: t.String({ format: 'uuid' }),
  teamKey: t.String(),
  teamName: t.String(),
});

const NotificationPageResponse = t.Object({
  items: t.Array(NotificationResponse),
  nextCursor: t.Nullable(t.Object({ ts: t.String(), id: t.String({ format: 'uuid' }) })),
});

const idParams = t.Object({ id: t.String({ format: 'uuid' }) });

// Inbox: the session user's own notifications across every team they are a
// member of. Every route is scoped to that user (no team permission needed to
// read your own inbox); single-notification actions only touch a row that belongs
// to the user.
export const notificationRoutes = new Elysia({
  name: 'notifications',
  detail: { tags: ['Notifications'] },
})
  .use(authContext)

  .get(
    '/notifications',
    async ({ user, query }) => {
      const userId = requireUser(user).id;
      const limit = query.limit != null ? Number(query.limit) : 30;
      let before = null;
      if (query.cursor) {
        try {
          before = JSON.parse(query.cursor);
        } catch {
          // Ignore a malformed cursor and serve the first page.
        }
      }
      const filters: NotificationFilters = {};
      if (query.types) {
        const types = query.types
          .split(',')
          .filter((x): x is NotificationType => (NOTIFICATION_TYPES as string[]).includes(x));
        if (types.length) filters.types = types;
      }
      if (query.from) filters.fromUserId = query.from;
      if (query.teamId) filters.teamId = query.teamId;
      filters.includeRead = query.includeRead !== 'false';
      filters.includeSnoozed = query.includeSnoozed === 'true';
      return listNotifications(userId, { before, limit, filters });
    },
    {
      query: t.Object({
        limit: t.Optional(t.String({ description: 'Max items per page (1-100). Default 30.' })),
        cursor: t.Optional(t.String({ description: 'nextCursor from the previous page.' })),
        types: t.Optional(
          t.String({ description: 'Comma-separated notification types to include.' }),
        ),
        from: t.Optional(t.String({ description: 'Filter by actor user id.' })),
        teamId: t.Optional(t.String({ description: 'Filter by team id.' })),
        includeRead: t.Optional(t.String({ description: "'false' hides read. Default true." })),
        includeSnoozed: t.Optional(
          t.String({ description: "'true' shows snoozed. Default false." }),
        ),
      }),
      response: { 200: NotificationPageResponse, 401: ErrorResponse },
      detail: { summary: 'List inbox notifications' },
    },
  )

  // Cheap change marker for the inbox: clients poll this and refetch the list and
  // badge only when it moves. Also returns the current unread count for the badge.
  .get(
    '/notifications/rev',
    async ({ user, query }) => {
      const userId = requireUser(user).id;
      const teamId = query.teamId ? query.teamId : undefined;
      const [rev, unread] = await Promise.all([
        notificationsRev(userId, teamId),
        unreadCount(userId, teamId),
      ]);
      return { rev, unread };
    },
    {
      query: t.Object({
        teamId: t.Optional(t.String({ description: 'Scope the marker to one team.' })),
      }),
      response: { 200: t.Object({ rev: t.String(), unread: t.Number() }), 401: ErrorResponse },
      detail: { summary: 'Get inbox revision and unread count' },
    },
  )

  .post(
    '/notifications/read-all',
    async ({ user, body }) => {
      const userId = requireUser(user).id;
      const count = await markAllRead(userId, body?.teamId ?? undefined);
      return { count };
    },
    {
      body: t.Optional(t.Object({ teamId: t.Optional(t.String({ format: 'uuid' })) })),
      response: { 200: t.Object({ count: t.Number() }), 401: ErrorResponse },
      detail: { summary: 'Mark all notifications read' },
    },
  )

  .delete(
    '/notifications',
    async ({ user, query }) => {
      const userId = requireUser(user).id;
      const scope = (query.scope ?? 'read') as DeleteScope;
      const teamId = query.teamId ? query.teamId : undefined;
      const count = await deleteNotifications(userId, scope, teamId);
      return { count };
    },
    {
      query: t.Object({
        scope: t.Optional(
          t.Union([t.Literal('all'), t.Literal('read'), t.Literal('read-completed')], {
            description: 'Which notifications to delete. Default read.',
          }),
        ),
        teamId: t.Optional(t.String({ description: 'Scope the delete to one team.' })),
      }),
      response: { 200: t.Object({ count: t.Number() }), 401: ErrorResponse },
      detail: { summary: 'Delete inbox notifications' },
    },
  )

  .post(
    '/notifications/:id/read',
    async ({ user, params, body }) => {
      const userId = requireUser(user).id;
      const read = body?.read ?? true;
      const ok = await setNotificationRead(userId, params.id, read);
      if (!ok) throw new HttpError(404, 'Notification not found');
      return noContent();
    },
    {
      params: idParams,
      body: t.Optional(t.Object({ read: t.Optional(t.Boolean()) })),
      response: { 204: t.Void(), 401: ErrorResponse, 404: ErrorResponse },
      detail: { summary: 'Mark a notification read or unread' },
    },
  )

  .post(
    '/notifications/:id/snooze',
    async ({ user, params, body }) => {
      const userId = requireUser(user).id;
      const until = body.until ? new Date(body.until) : null;
      if (until && Number.isNaN(until.getTime())) throw new HttpError(400, 'Invalid snooze time');
      const ok = await snoozeNotification(userId, params.id, until);
      if (!ok) throw new HttpError(404, 'Notification not found');
      return noContent();
    },
    {
      params: idParams,
      body: t.Object({ until: t.Nullable(t.String()) }),
      response: { 204: t.Void(), 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse },
      detail: {
        summary: 'Snooze a notification',
        description: 'Snooze a notification until a time, or clear its snooze.',
      },
    },
  )

  .delete(
    '/notifications/:id',
    async ({ user, params }) => {
      const userId = requireUser(user).id;
      const ok = await deleteNotification(userId, params.id);
      if (!ok) throw new HttpError(404, 'Notification not found');
      return noContent();
    },
    {
      params: idParams,
      response: { 204: t.Void(), 401: ErrorResponse, 404: ErrorResponse },
      detail: { summary: 'Delete a notification' },
    },
  );
