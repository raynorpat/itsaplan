import { db, initiative } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { eq } from 'drizzle-orm';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { initiativeData, type WebhookData } from '../webhooks/data';
import { canSeeInitiative } from './access';

// Initiatives (Linear's Initiative): workspace-level goals grouping projects. The
// store validates the fields and the owner rule, keeps the status timestamps and
// sends the Initiative webhooks; callers check access (access.ts) first.

export const INITIATIVE_STATUSES = ['Proposed', 'Planned', 'Active', 'Completed', 'Canceled'];
export type InitiativeStatus = 'Proposed' | 'Planned' | 'Active' | 'Completed' | 'Canceled';
const RESOLUTIONS = ['month', 'quarter', 'halfYear', 'year'];

export interface InitiativeRow {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  color: string | null;
  icon: string | null;
  status: InitiativeStatus;
  ownerUserId: string | null;
  creatorUserId: string | null;
  leadTeamId: string | null;
  priority: number;
  sortOrder: number;
  prioritySortOrder: number;
  targetDate: string | null;
  targetDateResolution: string | null;
  startedAt: string | null;
  completedAt: string | null;
  slugId: string;
  archivedAt: string | null;
  trashed: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewInitiativeInput {
  id?: string;
  name: string;
  description?: string | null;
  content?: string | null;
  color?: string | null;
  icon?: string | null;
  status?: InitiativeStatus;
  ownerId?: string | null;
  leadTeamId?: string | null;
  priority?: number;
  sortOrder?: number;
  prioritySortOrder?: number;
  targetDate?: string | null;
  targetDateResolution?: string | null;
}

export type InitiativePatch = Partial<Omit<NewInitiativeInput, 'id'>>;

const isoOrNull = (d: Date | null) => (d ? iso(d) : null);

export function mapInitiative(row: typeof initiative.$inferSelect): InitiativeRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    color: row.color,
    icon: row.icon,
    status: row.status as InitiativeStatus,
    ownerUserId: row.ownerUserId,
    creatorUserId: row.creatorUserId,
    leadTeamId: row.leadTeamId,
    priority: row.priority,
    sortOrder: row.sortOrder,
    prioritySortOrder: row.prioritySortOrder,
    targetDate: row.targetDate,
    targetDateResolution: row.targetDateResolution,
    startedAt: isoOrNull(row.startedAt),
    completedAt: isoOrNull(row.completedAt),
    slugId: row.slugId,
    archivedAt: isoOrNull(row.archivedAt),
    trashed: row.trashed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const initiativeUrl = (id: string) => `${trustedOrigins[0]}/initiatives/${id}`;

// By id or by slugId.
export async function getInitiative(idOrSlug: string): Promise<InitiativeRow | null> {
  const [row] = await db
    .select()
    .from(initiative)
    .where(UUID_RE.test(idOrSlug) ? eq(initiative.id, idOrSlug) : eq(initiative.slugId, idOrSlug));
  return row ? mapInitiative(row) : null;
}

function validate(input: InitiativePatch): void {
  if (input.name !== undefined && (input.name ?? '').trim() === '')
    throw new HttpError(400, 'Name must not be empty');
  if (
    input.priority !== undefined &&
    (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 4)
  )
    throw new HttpError(400, 'Priority must be an integer from 0 to 4');
  if (input.status !== undefined && !INITIATIVE_STATUSES.includes(input.status))
    throw new HttpError(400, `Unknown status ${input.status}`);
  if (input.targetDateResolution && !RESOLUTIONS.includes(input.targetDateResolution))
    throw new HttpError(400, `Unknown target date resolution ${input.targetDateResolution}`);
}

async function assertOwnerCanSee(ownerId: string | null, leadTeamId: string | null) {
  if (ownerId && !(await canSeeInitiative(ownerId, leadTeamId)))
    throw new HttpError(400, 'The owner must be able to see the initiative');
}

// Entering Active sets started_at; entering Completed sets completed_at; leaving
// Completed clears it (Linear).
function statusTimestamps(status: InitiativeStatus, now: Date) {
  return {
    completedAt: status === 'Completed' ? now : null,
    ...(status === 'Active' ? { startedAt: now } : {}),
  };
}

export async function sendInitiativeEvent(
  action: WebhookAction,
  id: string,
  actorUserId: string | null,
  before?: WebhookData | null,
): Promise<void> {
  const data = await initiativeData(id);
  if (!data) return;
  await emitEvent({
    type: 'Initiative',
    action,
    teamIds: data.leadTeamId ? [data.leadTeamId as string] : [],
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

export async function createInitiative(
  input: NewInitiativeInput,
  actorUserId: string,
): Promise<InitiativeRow> {
  validate(input);
  const status = input.status ?? 'Active';
  await assertOwnerCanSee(input.ownerId ?? null, input.leadTeamId ?? null);
  const now = new Date();
  const [row] = await db
    .insert(initiative)
    .values({
      ...(input.id ? { id: input.id } : {}),
      name: input.name.trim(),
      description: input.description ?? null,
      content: input.content ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      status,
      ownerUserId: input.ownerId ?? null,
      creatorUserId: actorUserId,
      leadTeamId: input.leadTeamId ?? null,
      priority: input.priority ?? 0,
      sortOrder: input.sortOrder ?? 0,
      prioritySortOrder: input.prioritySortOrder ?? 0,
      targetDate: input.targetDate ?? null,
      targetDateResolution: input.targetDateResolution ?? null,
      ...statusTimestamps(status, now),
    })
    .returning();
  await sendInitiativeEvent('create', row!.id, actorUserId);
  return mapInitiative(row!);
}

export async function updateInitiative(
  id: string,
  patch: InitiativePatch,
  actorUserId: string,
): Promise<InitiativeRow | null> {
  const current = await getInitiative(id);
  if (!current) return null;
  validate(patch);
  if (patch.ownerId !== undefined || patch.leadTeamId !== undefined)
    await assertOwnerCanSee(
      patch.ownerId !== undefined ? patch.ownerId : current.ownerUserId,
      patch.leadTeamId !== undefined ? patch.leadTeamId : current.leadTeamId,
    );
  const before = await initiativeData(current.id);
  const now = new Date();
  const { ownerId, name, ...rest } = patch;
  const [row] = await db
    .update(initiative)
    .set({
      ...rest,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(ownerId !== undefined ? { ownerUserId: ownerId } : {}),
      ...(patch.status && patch.status !== current.status
        ? statusTimestamps(patch.status, now)
        : {}),
      updatedAt: now,
    })
    .where(eq(initiative.id, current.id))
    .returning();
  await sendInitiativeEvent('update', current.id, actorUserId, before);
  return mapInitiative(row!);
}

// Archives the initiative; with `trash` it is also marked trashed (Linear's
// initiativeDelete).
export async function archiveInitiative(
  id: string,
  actorUserId: string,
  opts: { trash?: boolean } = {},
): Promise<InitiativeRow> {
  const [row] = await db
    .update(initiative)
    .set({ archivedAt: new Date(), trashed: opts.trash ? true : null })
    .where(eq(initiative.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Initiative not found');
  await sendInitiativeEvent('remove', id, actorUserId);
  return mapInitiative(row);
}

export async function unarchiveInitiative(id: string, actorUserId: string): Promise<InitiativeRow> {
  const before = await initiativeData(id);
  const [row] = await db
    .update(initiative)
    .set({ archivedAt: null, trashed: null, updatedAt: new Date() })
    .where(eq(initiative.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Initiative not found');
  await sendInitiativeEvent('update', id, actorUserId, before);
  return mapInitiative(row);
}
