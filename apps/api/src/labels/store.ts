import { db, label, labelGroup } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { issueLabelData, labelGroupData, type WebhookData } from '../webhooks/data';

// Sends an IssueLabel webhook event (labels and label groups alike).
async function emitLabel(
  action: WebhookAction,
  teamId: string,
  actorUserId: string | null,
  data: WebhookData | null,
  before?: WebhookData | null,
): Promise<void> {
  if (!data) return;
  await emitEvent({
    type: 'IssueLabel',
    action,
    teamIds: [teamId],
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

// Data access for labels and label groups. Both belong to one team. A label
// has at most one group; deleting a group ungroups its labels (group_id → SET
// NULL). Deleting a label removes it from every issue that has it (ON DELETE
// CASCADE on issue_label.label_id).

// --- Labels --------------------------------------------------------------------

export interface LabelRow {
  id: string;
  teamId: string;
  groupId: string | null;
  name: string;
  color: string;
}

function mapLabel(row: typeof label.$inferSelect): LabelRow {
  return {
    id: row.id,
    teamId: row.teamId,
    groupId: row.groupId ?? null,
    name: row.name,
    color: row.color,
  };
}

export async function listLabels(teamId: string): Promise<LabelRow[]> {
  const rows = await db.select().from(label).where(eq(label.teamId, teamId)).orderBy(label.name);
  return rows.map(mapLabel);
}

export async function createLabel(input: {
  teamId: string;
  name: string;
  color?: string;
  groupId?: string | null;
  actorUserId: string | null;
}): Promise<LabelRow> {
  const [row] = await db
    .insert(label)
    .values({
      teamId: input.teamId,
      name: input.name,
      color: input.color ?? '#6b7280',
      groupId: input.groupId ?? null,
    })
    .returning();
  await emitLabel('create', input.teamId, input.actorUserId, await issueLabelData(row.id));
  return mapLabel(row);
}

// Scoped to teamId so an id from another team resolves to null (a 404 at
// the route), never a cross-team edit.
export async function updateLabel(
  id: string,
  teamId: string,
  patch: { name?: string; color?: string; groupId?: string | null },
  actorUserId: string | null,
): Promise<LabelRow | null> {
  const scope = and(eq(label.id, id), eq(label.teamId, teamId));
  const set: Partial<typeof label.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.groupId !== undefined) set.groupId = patch.groupId;
  if (Object.keys(set).length === 0) {
    const rows = await db.select().from(label).where(scope);
    return rows[0] ? mapLabel(rows[0]) : null;
  }
  const before = await issueLabelData(id);
  const [row] = await db.update(label).set(set).where(scope).returning();
  if (row) await emitLabel('update', teamId, actorUserId, await issueLabelData(id), before);
  return row ? mapLabel(row) : null;
}

// Scoped to teamId: an id outside the team deletes nothing.
export async function deleteLabel(
  id: string,
  teamId: string,
  actorUserId: string | null,
): Promise<void> {
  const before = await issueLabelData(id);
  const rows = await db
    .delete(label)
    .where(and(eq(label.id, id), eq(label.teamId, teamId)))
    .returning({ id: label.id });
  if (rows.length) await emitLabel('remove', teamId, actorUserId, before);
}

// --- Label groups --------------------------------------------------------------

export interface LabelGroupRow {
  id: string;
  teamId: string;
  name: string;
  color: string;
}

function mapLabelGroup(row: typeof labelGroup.$inferSelect): LabelGroupRow {
  return { id: row.id, teamId: row.teamId, name: row.name, color: row.color };
}

export async function listLabelGroups(teamId: string): Promise<LabelGroupRow[]> {
  const rows = await db
    .select()
    .from(labelGroup)
    .where(eq(labelGroup.teamId, teamId))
    .orderBy(labelGroup.name);
  return rows.map(mapLabelGroup);
}

export async function createLabelGroup(input: {
  teamId: string;
  name: string;
  color?: string;
  actorUserId: string | null;
}): Promise<LabelGroupRow> {
  const [row] = await db
    .insert(labelGroup)
    .values({ teamId: input.teamId, name: input.name, color: input.color ?? '#6b7280' })
    .returning();
  await emitLabel('create', input.teamId, input.actorUserId, await labelGroupData(row.id));
  return mapLabelGroup(row);
}

// Scoped to teamId so an id from another team resolves to null (a 404 at
// the route), never a cross-team edit.
export async function updateLabelGroup(
  id: string,
  teamId: string,
  patch: { name?: string; color?: string },
  actorUserId: string | null,
): Promise<LabelGroupRow | null> {
  const scope = and(eq(labelGroup.id, id), eq(labelGroup.teamId, teamId));
  const set: Partial<typeof labelGroup.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.color !== undefined) set.color = patch.color;
  if (Object.keys(set).length === 0) {
    const rows = await db.select().from(labelGroup).where(scope);
    return rows[0] ? mapLabelGroup(rows[0]) : null;
  }
  const before = await labelGroupData(id);
  const [row] = await db.update(labelGroup).set(set).where(scope).returning();
  if (row) await emitLabel('update', teamId, actorUserId, await labelGroupData(id), before);
  return row ? mapLabelGroup(row) : null;
}

// Scoped to teamId: an id outside the team deletes nothing.
// Deleting a group ungroups its labels (FK SET NULL); each sends an IssueLabel
// update with parentId in updatedFrom, then the group sends its remove.
export async function deleteLabelGroup(
  id: string,
  teamId: string,
  actorUserId: string | null,
): Promise<void> {
  const before = await labelGroupData(id);
  if (!before || before.teamId !== teamId) return;
  const members = await db.select({ id: label.id }).from(label).where(eq(label.groupId, id));
  const membersBefore = await Promise.all(members.map((m) => issueLabelData(m.id)));
  await db.delete(labelGroup).where(and(eq(labelGroup.id, id), eq(labelGroup.teamId, teamId)));
  for (const [i, m] of members.entries())
    await emitLabel('update', teamId, actorUserId, await issueLabelData(m.id), membersBefore[i]);
  await emitLabel('remove', teamId, actorUserId, before);
}
