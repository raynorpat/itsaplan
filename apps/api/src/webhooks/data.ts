import { db, issueLabel, label, team, user, workflowState } from '@repo/db';
import { asc, eq } from 'drizzle-orm';
import { issueById } from '../graphql/resolvers/issue';

// The `data` of a webhook payload per resource type: the GraphQL mapper's output
// with the relation ids and small nested objects Linear puts in webhook data.

export type WebhookData = Record<string, unknown>;

export async function issueData(issueId: string): Promise<WebhookData | null> {
  const found = await issueById(issueId);
  if (!found) return null;
  const { assigneeUserId, delegateUserId, creatorUserId, ...rest } = found;
  const [teamRow] = await db
    .select({ id: team.id, key: team.key, name: team.name })
    .from(team)
    .where(eq(team.id, found.teamId));
  const [stateRow] = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      color: workflowState.color,
      type: workflowState.stateType,
    })
    .from(workflowState)
    .where(eq(workflowState.id, found.stateId));
  const assignee = assigneeUserId
    ? ((
        await db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, assigneeUserId))
      )[0] ?? null)
    : null;
  const labels = await db
    .select({ id: label.id, name: label.name, color: label.color })
    .from(issueLabel)
    .innerJoin(label, eq(label.id, issueLabel.labelId))
    .where(eq(issueLabel.issueId, issueId))
    .orderBy(asc(label.id));
  return {
    ...rest,
    assigneeId: assigneeUserId,
    delegateId: delegateUserId,
    creatorId: creatorUserId,
    labelIds: labels.map((l) => l.id),
    team: teamRow ?? null,
    state: stateRow ?? null,
    assignee,
    labels,
  };
}
