import { Elysia, t } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { issueData } from './data';
import { emitEvent } from './event';

// The worker's auto-archive sweep sets archived_at with raw SQL and cannot build
// webhook payloads, so it reports the archived issue ids here. Each sends an
// Issue update with no actor; the issue was unarchived before the sweep.
export const internalWebhookRoutes = new Elysia({ name: 'internal-webhooks' }).post(
  '/internal/webhooks/issues-archived',
  async ({ body, headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    for (const id of body.issueIds) {
      const data = await issueData(id);
      if (!data) continue;
      await emitEvent({
        type: 'Issue',
        action: 'update',
        teamIds: [data.teamId as string],
        actorUserId: null,
        data,
        before: { ...data, archivedAt: null },
      });
    }
    return { sent: body.issueIds.length };
  },
  { body: t.Object({ issueIds: t.Array(t.String({ format: 'uuid' })) }) },
);
