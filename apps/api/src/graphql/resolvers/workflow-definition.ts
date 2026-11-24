import { db, workflowDefinition } from '@repo/db';
import { inArray } from 'drizzle-orm';

// Linear's ActorBot for a change or comment a workflow automation made (workflows/).
// Linear's schema has no query for WorkflowDefinition itself, so a rule is reached
// only as this bot actor, loaded per request (graphql/loaders.ts `workflowBot`).

export interface WorkflowBotActor {
  id: string;
  type: 'workflow';
  subType: null;
  name: string;
  userDisplayName: null;
  avatarUrl: null;
}

// The bot actors of the given rule ids, in key order. A deleted rule keeps its row and
// is still named here; null only when its team, and so the rule, is gone.
export async function workflowBotActors(
  ids: readonly string[],
): Promise<(WorkflowBotActor | null)[]> {
  const rows = await db
    .select({ id: workflowDefinition.id, name: workflowDefinition.name })
    .from(workflowDefinition)
    .where(inArray(workflowDefinition.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const row = byId.get(id);
    return row
      ? {
          id: row.id,
          type: 'workflow',
          subType: null,
          name: row.name,
          userDisplayName: null,
          avatarUrl: null,
        }
      : null;
  });
}
