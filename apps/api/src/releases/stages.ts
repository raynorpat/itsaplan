import { db, release, releasePipeline, releaseStage } from '@repo/db';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { assertPipelineRead, assertPipelineWrite, visiblePipelinesSql } from './access';

// Release stages (Linear's ReleaseStage). Every pipeline keeps exactly one planned, one
// completed and one canceled stage and at least one started stage. Only a scheduled
// pipeline's stages change: rename, recolour, reorder, freeze, and add or archive
// started stages ("QA", "Staging"). A continuous pipeline keeps its four.

export type StageType = 'planned' | 'started' | 'completed' | 'canceled';

export interface StageDto {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  type: StageType;
  position: number;
  frozen: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageInput {
  id?: string;
  pipelineId?: string;
  name?: string;
  color?: string;
  type?: string;
  position?: number;
  frozen?: boolean;
}

type Row = typeof releaseStage.$inferSelect;

export async function stagesByIds(ids: readonly string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(releaseStage)
    .where(inArray(releaseStage.id, [...ids]));
}

export const mapStage = (row: Row): StageDto => ({
  id: row.id,
  pipelineId: row.pipelineId,
  name: row.name,
  color: row.color,
  type: row.type as StageType,
  position: row.position,
  frozen: row.frozen,
  archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

const HEX = /^#[0-9a-f]{6}$/i;

function cleanColor(value: unknown): string {
  if (typeof value !== 'string' || !HEX.test(value))
    throw new HttpError(400, 'color must be a hex colour such as #5e6ad2');
  return value;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  if (value.trim().length > 255) throw new HttpError(400, 'name is at most 255 characters');
  return value.trim();
}

function cleanPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new HttpError(400, 'position must be a number');
  return value;
}

function assertScheduled(pipeline: typeof releasePipeline.$inferSelect): void {
  if (pipeline.type !== 'scheduled')
    throw new HttpError(400, "Only a scheduled pipeline's stages can change");
}

// The pipeline's active stages in order.
export async function pipelineStages(pipelineId: string): Promise<StageDto[]> {
  const rows = await db
    .select()
    .from(releaseStage)
    .where(and(eq(releaseStage.pipelineId, pipelineId), isNull(releaseStage.archivedAt)))
    .orderBy(asc(releaseStage.position), asc(releaseStage.createdAt));
  return rows.map(mapStage);
}

// The stage (archived included) when the user may read its pipeline, else 404.
async function readableStage(user: AuthUser | undefined | null, id: string): Promise<Row> {
  const notFound = new HttpError(404, `Release stage ${id} not found`);
  if (!UUID_RE.test(id)) throw notFound;
  const [row] = await db.select().from(releaseStage).where(eq(releaseStage.id, id));
  if (!row) throw notFound;
  try {
    await assertPipelineRead(user, row.pipelineId);
  } catch {
    throw notFound;
  }
  return row;
}

export async function getStage(user: AuthUser | undefined | null, id: string): Promise<StageDto> {
  return mapStage(await readableStage(user, id));
}

// SQL condition for stage lists: stages of pipelines the user may read.
export const visibleStagesSql = (userId: string) =>
  sql`${releaseStage.pipelineId} IN (SELECT ${releasePipeline.id} FROM ${releasePipeline} WHERE ${visiblePipelinesSql(userId)})`;

export async function createStage(
  user: AuthUser | undefined | null,
  input: StageInput,
): Promise<StageDto> {
  if (typeof input.pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
  const pipeline = await assertPipelineWrite(user, input.pipelineId);
  assertScheduled(pipeline);
  if (input.type !== 'started') throw new HttpError(400, 'Only started stages can be added');
  const [row] = await db
    .insert(releaseStage)
    .values({
      ...(input.id ? { id: input.id } : {}),
      pipelineId: pipeline.id,
      name: cleanName(input.name),
      color: cleanColor(input.color),
      type: 'started',
      position: cleanPosition(input.position),
      frozen: !!input.frozen,
    })
    .returning();
  return mapStage(row!);
}

export async function updateStage(
  user: AuthUser | undefined | null,
  id: string,
  input: StageInput,
): Promise<StageDto> {
  const stage = await readableStage(user, id);
  assertScheduled(await assertPipelineWrite(user, stage.pipelineId));
  const set: Partial<typeof releaseStage.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = cleanName(input.name);
  if (input.color !== undefined) set.color = cleanColor(input.color);
  if (input.position !== undefined) set.position = cleanPosition(input.position);
  if (input.frozen !== undefined) set.frozen = !!input.frozen;
  const [row] = await db.update(releaseStage).set(set).where(eq(releaseStage.id, id)).returning();
  return mapStage(row!);
}

// Archiving keeps a pipeline's planned, completed and canceled stages and its last
// started stage, and is refused while active releases are in the stage.
export async function archiveStage(
  user: AuthUser | undefined | null,
  id: string,
): Promise<StageDto> {
  const stage = await readableStage(user, id);
  assertScheduled(await assertPipelineWrite(user, stage.pipelineId));
  if (stage.type !== 'started')
    throw new HttpError(400, 'A pipeline keeps its planned, completed and canceled stages');
  const [other] = await db
    .select({ id: releaseStage.id })
    .from(releaseStage)
    .where(
      and(
        eq(releaseStage.pipelineId, stage.pipelineId),
        eq(releaseStage.type, 'started'),
        ne(releaseStage.id, id),
        isNull(releaseStage.archivedAt),
      ),
    )
    .limit(1);
  if (!other) throw new HttpError(400, 'A pipeline keeps at least one started stage');
  const [inUse] = await db
    .select({ id: release.id })
    .from(release)
    .where(and(eq(release.stageId, id), isNull(release.archivedAt)))
    .limit(1);
  if (inUse) throw new HttpError(400, 'Move the releases in this stage before archiving it');
  const [row] = await db
    .update(releaseStage)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(releaseStage.id, id))
    .returning();
  return mapStage(row!);
}

export async function unarchiveStage(
  user: AuthUser | undefined | null,
  id: string,
): Promise<StageDto> {
  const stage = await readableStage(user, id);
  assertScheduled(await assertPipelineWrite(user, stage.pipelineId));
  const [row] = await db
    .update(releaseStage)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(releaseStage.id, id))
    .returning();
  return mapStage(row!);
}
