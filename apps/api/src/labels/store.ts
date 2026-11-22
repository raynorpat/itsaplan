import { db, label } from '@repo/db';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { issueLabelData, type WebhookData } from '../webhooks/data';

// Labels in Linear's shape. A label belongs to one team, or to no team (a
// workspace label, usable on every team's issues). A group is a label with
// is_group set: it holds child labels (parent_id) of the same scope, cannot be
// applied to an issue and cannot itself have a parent. A retired label stays on
// the issues that have it but cannot be newly applied. Deleting a group ungroups
// its labels; deleting a label removes it from every issue (ON DELETE CASCADE on
// issue_label.label_id).

// Sends an IssueLabel webhook event: a team label to that team's webhooks, a
// workspace label to all-teams webhooks only.
async function emitLabel(
  action: WebhookAction,
  teamId: string | null,
  actorUserId: string | null,
  data: WebhookData | null,
  before?: WebhookData | null,
): Promise<void> {
  if (!data) return;
  await emitEvent({
    type: 'IssueLabel',
    action,
    teamIds: teamId ? [teamId] : [],
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

// --- Labels --------------------------------------------------------------------

export interface LabelRow {
  id: string;
  teamId: string | null;
  // The REST name of parent_id: the group the label belongs to.
  groupId: string | null;
  name: string;
  color: string;
  retiredAt: string | null;
}

function mapLabel(row: typeof label.$inferSelect): LabelRow {
  return {
    id: row.id,
    teamId: row.teamId,
    groupId: row.parentId,
    name: row.name,
    color: row.color,
    retiredAt: row.retiredAt ? iso(row.retiredAt) : null,
  };
}

// Labels of the team's scope: the team's own and workspace labels.
const inScope = (teamId: string): SQL => or(eq(label.teamId, teamId), isNull(label.teamId))!;

// The team's labels and workspace labels (not groups), retired ones included.
export async function listLabels(teamId: string): Promise<LabelRow[]> {
  const rows = await db
    .select()
    .from(label)
    .where(and(inScope(teamId), eq(label.isGroup, false)))
    .orderBy(label.name);
  return rows.map(mapLabel);
}

export async function getLabel(id: string): Promise<typeof label.$inferSelect | null> {
  const [row] = await db.select().from(label).where(eq(label.id, id));
  return row ?? null;
}

// A group must be an is_group label of the same scope.
async function assertGroup(groupId: string | null | undefined, teamId: string | null) {
  if (!groupId) return;
  const group = await getLabel(groupId);
  if (!group?.isGroup || group.teamId !== teamId)
    throw new HttpError(400, 'groupId must be a label group of the same team');
}

export async function createLabel(input: {
  teamId: string | null;
  name: string;
  color?: string;
  groupId?: string | null;
  description?: string | null;
  isGroup?: boolean;
  actorUserId: string | null;
  id?: string;
}): Promise<LabelRow> {
  if (input.isGroup && input.groupId) throw new HttpError(400, 'A label group cannot be nested');
  await assertGroup(input.groupId, input.teamId);
  const [row] = await db
    .insert(label)
    .values({
      ...(input.id ? { id: input.id } : {}),
      teamId: input.teamId,
      name: input.name,
      color: input.color ?? '#6b7280',
      parentId: input.groupId ?? null,
      description: input.description ?? null,
      isGroup: input.isGroup ?? false,
      creatorUserId: input.actorUserId,
    })
    .returning();
  await emitLabel('create', input.teamId, input.actorUserId, await issueLabelData(row!.id));
  return mapLabel(row!);
}

// Scoped to scopeTeamId (null = workspace) so an id from another scope resolves to
// null (a 404 at the route), never a cross-team edit.
export async function updateLabel(
  id: string,
  scopeTeamId: string | null,
  patch: { name?: string; color?: string; groupId?: string | null; description?: string | null },
  actorUserId: string | null,
): Promise<LabelRow | null> {
  const found = await getLabel(id);
  if (!found || found.teamId !== scopeTeamId) return null;
  if (patch.groupId !== undefined) {
    if (found.isGroup && patch.groupId) throw new HttpError(400, 'A label group cannot be nested');
    await assertGroup(patch.groupId, scopeTeamId);
  }
  const set: Partial<typeof label.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.groupId !== undefined) set.parentId = patch.groupId;
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) return mapLabel(found);
  const before = await issueLabelData(id);
  const [row] = await db
    .update(label)
    // updated_at uses the database clock, like created_at's default, so it never
    // reads earlier than the creation time.
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(label.id, id))
    .returning();
  await emitLabel('update', scopeTeamId, actorUserId, await issueLabelData(id), before);
  return row ? mapLabel(row) : null;
}

// Sets or clears retired_at. Returns null when the label does not exist.
async function setRetired(id: string, retired: boolean, actorUserId: string | null) {
  const before = await issueLabelData(id);
  const [row] = await db
    .update(label)
    .set({ retiredAt: retired ? new Date() : null, updatedAt: sql`now()` })
    .where(eq(label.id, id))
    .returning();
  if (!row) return null;
  await emitLabel('update', row.teamId, actorUserId, await issueLabelData(id), before);
  return mapLabel(row);
}

export const retireLabel = (id: string, actorUserId: string | null) =>
  setRetired(id, true, actorUserId);
export const restoreLabel = (id: string, actorUserId: string | null) =>
  setRetired(id, false, actorUserId);

// Deletes a label of the given scope. Deleting a group ungroups its labels first,
// so each sends an IssueLabel update with parentId in updatedFrom, then the group
// sends its remove. An id outside the scope deletes nothing.
export async function deleteLabel(
  id: string,
  scopeTeamId: string | null,
  actorUserId: string | null,
): Promise<void> {
  const found = await getLabel(id);
  if (!found || found.teamId !== scopeTeamId) return;
  const before = await issueLabelData(id);
  const members = found.isGroup
    ? await db.select({ id: label.id }).from(label).where(eq(label.parentId, id))
    : [];
  const membersBefore = await Promise.all(members.map((m) => issueLabelData(m.id)));
  await db.transaction(async (tx) => {
    // Ungrouped explicitly (rather than by the FK's SET NULL) so updated_at moves.
    if (members.length)
      await tx
        .update(label)
        .set({ parentId: null, updatedAt: sql`now()` })
        .where(eq(label.parentId, id));
    await tx.delete(label).where(eq(label.id, id));
  });
  for (const [i, m] of members.entries())
    await emitLabel(
      'update',
      scopeTeamId,
      actorUserId,
      await issueLabelData(m.id),
      membersBefore[i],
    );
  await emitLabel('remove', scopeTeamId, actorUserId, before);
}

// Labels that may newly go on an issue of `teamId`: the team's or workspace labels,
// not groups, not retired. A retired label already on the issue may stay
// (alreadyOnIssue). Throws 400 otherwise.
export async function assertLabelsApplicable(
  teamId: string,
  labelIds: string[],
  alreadyOnIssue: string[] = [],
): Promise<void> {
  const ids = [...new Set(labelIds)];
  if (ids.length === 0) return;
  const rows = await db.select().from(label).where(inArray(label.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || (row.teamId !== null && row.teamId !== teamId))
      throw new HttpError(400, "Labels must belong to the issue's team or the workspace");
    if (row.isGroup) throw new HttpError(400, 'A label group cannot be applied to an issue');
    if (row.retiredAt && !alreadyOnIssue.includes(id))
      throw new HttpError(400, 'A retired label cannot be applied');
  }
}

// --- Label groups --------------------------------------------------------------
// The REST label-group routes act on is_group labels of the team.

export interface LabelGroupRow {
  id: string;
  teamId: string | null;
  name: string;
  color: string;
}

function mapLabelGroup(row: typeof label.$inferSelect): LabelGroupRow {
  return { id: row.id, teamId: row.teamId, name: row.name, color: row.color };
}

// The team's groups and workspace groups.
export async function listLabelGroups(teamId: string): Promise<LabelGroupRow[]> {
  const rows = await db
    .select()
    .from(label)
    .where(and(inScope(teamId), eq(label.isGroup, true)))
    .orderBy(label.name);
  return rows.map(mapLabelGroup);
}

export async function createLabelGroup(input: {
  teamId: string;
  name: string;
  color?: string;
  actorUserId: string | null;
}): Promise<LabelGroupRow> {
  const created = await createLabel({ ...input, isGroup: true });
  return { id: created.id, teamId: created.teamId, name: created.name, color: created.color };
}

// Scoped to teamId; null when the group is not one of the team's groups.
export async function updateLabelGroup(
  id: string,
  teamId: string,
  patch: { name?: string; color?: string },
  actorUserId: string | null,
): Promise<LabelGroupRow | null> {
  const found = await getLabel(id);
  if (!found?.isGroup || found.teamId !== teamId) return null;
  const updated = await updateLabel(id, teamId, patch, actorUserId);
  return updated
    ? { id: updated.id, teamId: updated.teamId, name: updated.name, color: updated.color }
    : null;
}

export async function deleteLabelGroup(
  id: string,
  teamId: string,
  actorUserId: string | null,
): Promise<void> {
  const found = await getLabel(id);
  if (!found?.isGroup || found.teamId !== teamId) return;
  await deleteLabel(id, teamId, actorUserId);
}
