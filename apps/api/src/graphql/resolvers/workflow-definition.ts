import { db, workflowDefinition } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { WorkflowRow } from '../../workflows/store';
import type { GraphQLContext } from '../context';
import { userById } from './issue';
import { findTeam, toTeam } from './team';

// Linear's WorkflowDefinition for a team automation rule (workflows/). Linear's schema
// has no query that lists rules, so this type is reached through references (an issue
// history entry's or a comment's workflow). Fields the rules do not have read their
// neutral values.

// Linear's ActorBot for a change or comment a workflow automation made; null when the
// row has no workflow or the rule was deleted.
export async function workflowBotActor(workflowId: string | null | undefined) {
  if (!workflowId) return null;
  const [row] = await db
    .select({ id: workflowDefinition.id, name: workflowDefinition.name })
    .from(workflowDefinition)
    .where(eq(workflowDefinition.id, workflowId));
  if (!row) return null;
  return {
    id: row.id,
    type: 'workflow',
    subType: null,
    name: row.name,
    userDisplayName: null,
    avatarUrl: null,
  };
}

export type GraphQLWorkflowDefinition = ReturnType<typeof toWorkflowDefinition>;

export function toWorkflowDefinition(row: WorkflowRow) {
  return {
    id: row.id,
    slugId: row.slugId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    type: row.type,
    triggerType: row.triggerType,
    trigger: row.trigger,
    activationMode: row.activationMode,
    conditions: row.conditions,
    // Linear's activities is a JSON object; the rule's actions are under `actions`.
    activities: { actions: row.activities },
    enabled: row.enabled,
    sortOrder: String(row.sortOrder),
    editAccess: row.editAccess,
    restrictEditing: row.editAccess !== 'everyone',
    stats: row.stats,
    lastExecutedAt: row.lastExecutedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    applyToSubTeams: false,
    postResultsToEntity: false,
    runOnce: false,
    trashed: null,
    teamId: row.teamId,
    creatorId: row.creatorId,
    ownerId: row.ownerId,
    lastUpdatedById: row.lastUpdatedById,
  };
}

export const workflowDefinitionResolvers = {
  WorkflowDefinition: {
    team: async (w: GraphQLWorkflowDefinition, _: unknown, ctx: GraphQLContext) =>
      toTeam(await findTeam(w.teamId, ctx.user.id)),
    creator: (w: GraphQLWorkflowDefinition, _: unknown, ctx: GraphQLContext) =>
      userById(w.creatorId, ctx.user.id),
    owner: (w: GraphQLWorkflowDefinition, _: unknown, ctx: GraphQLContext) =>
      userById(w.ownerId, ctx.user.id),
    lastUpdatedBy: (w: GraphQLWorkflowDefinition, _: unknown, ctx: GraphQLContext) =>
      userById(w.lastUpdatedById, ctx.user.id),
  },
};
