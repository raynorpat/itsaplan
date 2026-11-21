import { Elysia, t } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { issueData } from './data';
import { db, issue } from '@repo/db';
import { inArray } from 'drizzle-orm';
import { emitEvent, isWatched } from './event';

// The worker's auto-archive sweep sets archived_at with raw SQL and cannot build
// webhook payloads, so it reports the archived issue ids here. Each sends an
// Issue update with no actor. The sweep reports each issue's updated_at from
// before it, since the sweep moves it.
export const internalWebhookRoutes = new Elysia({ name: 'internal-webhooks' }).post(
  '/internal/webhooks/issues-archived',
  async ({ body, headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    const teams = body.issues.length
      ? await db
          .selectDistinct({ teamId: issue.teamId })
          .from(issue)
          .where(
            inArray(
              issue.id,
              body.issues.map((i) => i.id),
            ),
          )
      : [];
    if (
      !(await isWatched(
        'Issue',
        teams.map((t) => t.teamId),
      ))
    )
      return { sent: 0 };
    for (const { id, previousUpdatedAt } of body.issues) {
      const data = await issueData(id);
      if (!data) continue;
      await emitEvent({
        type: 'Issue',
        action: 'update',
        teamIds: [data.teamId as string],
        actorUserId: null,
        data,
        before: { ...data, archivedAt: null, updatedAt: new Date(previousUpdatedAt).toISOString() },
      });
    }
    return { sent: body.issues.length };
  },
  {
    body: t.Object({
      issues: t.Array(
        t.Object({ id: t.String({ format: 'uuid' }), previousUpdatedAt: t.String() }),
      ),
    }),
  },
);
