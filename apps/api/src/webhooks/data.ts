import {
  db,
  initiative,
  initiativeRelation,
  initiativeToProject,
  issueLabel,
  label,
  project,
  projectUpdate,
  team,
  user,
  workflowState,
} from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { asc, eq } from 'drizzle-orm';
import { toComment } from '../graphql/resolvers/comment';
import { commentParentUrl, getComment } from '../comments/store';
import { issueById } from '../graphql/resolvers/issue';
import { toIssueLabel } from '../graphql/resolvers/issue-label';
import { toProject, toUpdate } from '../graphql/resolvers/project';
import { getProject } from '../projects/store';
import { getInitiative, initiativeUrl } from '../initiatives/store';

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

export async function commentData(commentId: string): Promise<WebhookData | null> {
  const found = await getComment(commentId);
  if (!found) return null;
  return toComment(found, await commentParentUrl(found));
}

export async function issueLabelData(labelId: string): Promise<WebhookData | null> {
  const [row] = await db.select().from(label).where(eq(label.id, labelId));
  return row ? toIssueLabel(row) : null;
}

// All of the project's teams (no visibility filter): webhooks are scoped by team.
export async function projectData(projectId: string): Promise<WebhookData | null> {
  const found = await getProject(projectId);
  if (!found) return null;
  const { visibleTeamIds, leadUserId, labelIds, ...rest } = toProject(found);
  return {
    ...rest,
    teamIds: [...visibleTeamIds].sort(),
    leadId: leadUserId,
    labelIds: [...labelIds].sort(),
  };
}

export async function projectUpdateData(updateId: string): Promise<WebhookData | null> {
  const [row] = await db.select().from(projectUpdate).where(eq(projectUpdate.id, updateId));
  return row ? toUpdate(row) : null;
}

// Linear's InitiativeWebhookPayload, with the fields this instance has.
export async function initiativeData(id: string): Promise<WebhookData | null> {
  const row = await getInitiative(id);
  if (!row) return null;
  const { ownerUserId, creatorUserId, content: _content, ...rest } = row;
  const origin = trustedOrigins[0];
  const projects = await db
    .select({ id: project.id, name: project.name })
    .from(initiativeToProject)
    .innerJoin(project, eq(project.id, initiativeToProject.projectId))
    .where(eq(initiativeToProject.initiativeId, id))
    .orderBy(asc(project.id));
  const relative = (on: 'parent' | 'child') =>
    db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiativeRelation)
      .innerJoin(
        initiative,
        eq(
          initiative.id,
          on === 'parent'
            ? initiativeRelation.initiativeId
            : initiativeRelation.relatedInitiativeId,
        ),
      )
      .where(
        eq(
          on === 'parent'
            ? initiativeRelation.relatedInitiativeId
            : initiativeRelation.initiativeId,
          row.id,
        ),
      )
      .orderBy(asc(initiative.id));
  const [parent, children] = await Promise.all([relative('parent'), relative('child')]);
  return {
    ...rest,
    description: row.description ?? '',
    ownerId: ownerUserId,
    creatorId: creatorUserId,
    url: initiativeUrl(row.id),
    labelIds: [],
    frequencyResolution: 'weekly',
    health: null,
    healthUpdatedAt: null,
    lastUpdateId: null,
    projects: projects.map((p) => ({ id: p.id, name: p.name, url: `${origin}/projects/${p.id}` })),
    parentInitiative: parent[0] ? childInitiative(parent[0]) : null,
    subInitiatives: children.map(childInitiative),
  };
}

const childInitiative = (i: { id: string; name: string }) => ({
  id: i.id,
  name: i.name,
  url: initiativeUrl(i.id),
});
