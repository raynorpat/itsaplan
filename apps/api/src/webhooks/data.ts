import {
  db,
  initiative,
  initiativeRelation,
  initiativeToProject,
  issueLabel,
  label,
  project,
  projectTeam,
  projectUpdate,
  team,
  user,
  workflowState,
} from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { toComment } from '../graphql/resolvers/comment';
import { commentParentUrl, getComment } from '../comments/store';
import { issueById } from '../graphql/resolvers/issue';
import { toIssueLabel } from '../graphql/resolvers/issue-label';
import { toProject, toUpdate } from '../graphql/resolvers/project';
import { getProject, projectMemberIds } from '../projects/store';
import { getInitiative, initiativeUrl } from '../initiatives/store';
import { getInitiativeUpdate, latestInitiativeUpdate } from '../initiatives/updates';
import { documentUrl, getDocument } from '../documents/store';
import { attachmentUrl, type AttachmentRow } from '../attachments/store';
import { subscriberIds } from '../notifications/subscriptions';
import { shownNameSql } from '../shared/user-name';

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
          .select({ id: user.id, name: shownNameSql, email: user.email })
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
    subscriberIds: await subscriberIds(issueId),
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
    memberIds: await projectMemberIds(projectId),
  };
}

export async function projectUpdateData(updateId: string): Promise<WebhookData | null> {
  const [row] = await db.select().from(projectUpdate).where(eq(projectUpdate.id, updateId));
  return row ? toUpdate(row) : null;
}

// Linear's InitiativeWebhookPayload, with the fields this instance has. The event
// of a lead-team initiative goes to that team's webhooks, so its related projects
// and initiatives are limited to those the team can see: projects of the team, and
// initiatives led by the team or by no team.
export async function initiativeData(id: string): Promise<WebhookData | null> {
  const row = await getInitiative(id);
  if (!row) return null;
  const { ownerUserId, creatorUserId, content: _content, ...rest } = row;
  const origin = trustedOrigins[0];
  const lead = row.leadTeamId;
  const projects = await db
    .select({ id: project.id, name: project.name })
    .from(initiativeToProject)
    .innerJoin(project, eq(project.id, initiativeToProject.projectId))
    .where(
      and(
        eq(initiativeToProject.initiativeId, id),
        lead
          ? inArray(
              project.id,
              db
                .select({ id: projectTeam.projectId })
                .from(projectTeam)
                .where(eq(projectTeam.teamId, lead)),
            )
          : undefined,
      ),
    )
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
        and(
          eq(
            on === 'parent'
              ? initiativeRelation.relatedInitiativeId
              : initiativeRelation.initiativeId,
            row.id,
          ),
          lead ? or(isNull(initiative.leadTeamId), eq(initiative.leadTeamId, lead)) : undefined,
        ),
      )
      .orderBy(asc(initiative.id));
  const [parent, children, last] = await Promise.all([
    relative('parent'),
    relative('child'),
    latestInitiativeUpdate(row.id),
  ]);
  return {
    ...rest,
    description: row.description ?? '',
    ownerId: ownerUserId,
    creatorId: creatorUserId,
    url: initiativeUrl(row.id),
    labelIds: [],
    frequencyResolution: 'weekly',
    health: last?.health ?? null,
    healthUpdatedAt: last?.createdAt ?? null,
    lastUpdateId: last?.id ?? null,
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

// Linear's InitiativeUpdateWebhookPayload, with the fields this instance has.
export async function initiativeUpdateData(id: string): Promise<WebhookData | null> {
  const row = await getInitiativeUpdate(id);
  if (!row) return null;
  const parent = await getInitiative(row.initiativeId);
  return {
    ...row,
    url: initiativeUrl(row.initiativeId),
    initiative: parent ? childInitiative(parent) : null,
  };
}

// Linear's DocumentWebhookPayload, with the fields this instance has, plus issueId.
export async function documentData(id: string): Promise<WebhookData | null> {
  const row = await getDocument(id);
  if (!row) return null;
  const { creatorUserId, updatedByUserId, ownerUserId, ...rest } = row;
  return {
    ...rest,
    creatorId: creatorUserId,
    updatedById: updatedByUserId,
    ownerId: ownerUserId,
    initiativeId: null,
    subscriberIds: [],
    url: await documentUrl(row),
  };
}

// Linear's AttachmentWebhookPayload, with the fields this instance has.
export function attachmentData(row: AttachmentRow): WebhookData {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
    title: row.title,
    subtitle: row.subtitle,
    url: attachmentUrl(row),
    creatorId: row.creatorUserId,
    externalUserCreatorId: null,
    issueId: row.issueId,
    originalIssueId: null,
    metadata: row.metadata,
    source: null,
    sourceType: row.sourceType,
    groupBySource: row.groupBySource,
  };
}
