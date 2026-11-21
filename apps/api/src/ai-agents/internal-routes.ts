import { Elysia, t } from 'elysia';
import { runAgent } from './runtime';
import { deleteThreadsWhere } from './runtime/memory';
import { runThreadId } from './runtime/thread-ids';
import { framePrompt, runModePreamble, peopleContext } from './prompt/framing';

const runBody = t.Object({
  id: t.String({ format: 'uuid' }),
  agentId: t.String({ format: 'uuid' }),
  issueId: t.Nullable(t.String({ format: 'uuid' })),
  scheduleId: t.Nullable(t.String({ format: 'uuid' })),
  trigger: t.UnionEnum(['mention', 'delegation', 'schedule', 'manual']),
  prompt: t.String(),
  projectId: t.String({ format: 'uuid' }),
  agentUserId: t.String({ format: 'uuid' }),
  issueIdentifier: t.Nullable(t.String()),
  issueTitle: t.Nullable(t.String()),
  assigneeUserId: t.Nullable(t.String({ format: 'uuid' })),
  assigneeName: t.Nullable(t.String()),
  requesterUserId: t.Nullable(t.String({ format: 'uuid' })),
  requesterName: t.Nullable(t.String()),
});

function workerTokenValid(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.WORKER_INTERNAL_TOKEN;
  return !!expected && headers['x-worker-token'] === expected;
}

export const internalAgentRunRoutes = new Elysia({ name: 'internal-agent-runs' })
  .post(
    '/internal/agent-runs/execute',
    async ({ body, headers, set }) => {
      if (!workerTokenValid(headers)) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const result = await runAgent(body.agentId, body.projectId, framePrompt(body), {
        callerUserId: body.agentUserId,
        threadId: runThreadId(body),
        issueId: body.issueId,
        scheduleId: body.scheduleId,
        contextPreamble: runModePreamble(body.trigger) + peopleContext(body),
      });
      return { output: result.text };
    },
    { body: runBody },
  )

  // Deletes the agent memory of archived issues. The worker's auto-archive sweep
  // writes archived_at directly in the database and does not import Mastra, so it
  // asks the api to drop the threads the same way it asks it to run an agent.
  .post(
    '/internal/agent-threads/delete-for-issues',
    async ({ body, headers, set }) => {
      if (!workerTokenValid(headers)) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      let deleted = 0;
      for (const issueId of body.issueIds) deleted += await deleteThreadsWhere({ issueId });
      return { deleted };
    },
    { body: t.Object({ issueIds: t.Array(t.String({ format: 'uuid' })) }) },
  );
