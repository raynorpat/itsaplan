import { db, release, releasePipeline, releasePipelineTeam, releaseStage, team } from '@repo/db';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { trustedOrigins } from '@repo/auth';
import { assertWorkspaceRole, visibleTeamIds, type AuthUser } from '../shared/access';
import { HttpError, iso, pgErrorCode } from '../shared/lib';
import { assertPipelineRead, assertPipelineWrite, visiblePipelinesSql } from './access';

// Release pipelines (Linear's ReleasePipeline). A new pipeline gets the four stages
// Planned, In progress, Completed and Canceled. Deleting trashes it (archived and
// `trashed`), as Linear does; unarchiving restores either.

export type PipelineType = 'continuous' | 'scheduled';
const TYPES: PipelineType[] = ['continuous', 'scheduled'];

export interface PipelineDto {
  id: string;
  slugId: string;
  name: string;
  type: PipelineType;
  isProduction: boolean;
  includePathPatterns: string[];
  rolloverIssuesOnCompletion: boolean;
  autoGenerateReleaseNotesOnCompletion: boolean;
  archivedAt: string | null;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineInput {
  id?: string;
  name?: string;
  slugId?: string;
  type?: string;
  isProduction?: boolean;
  includePathPatterns?: string[];
  rolloverIssuesOnCompletion?: boolean;
  autoGenerateReleaseNotesOnCompletion?: boolean;
  teamIds?: string[];
}

export const DEFAULT_STAGES = [
  { name: 'Planned', type: 'planned', color: '#95a2b3', position: 1000 },
  { name: 'In progress', type: 'started', color: '#f2c94c', position: 2000 },
  { name: 'Completed', type: 'completed', color: '#5e6ad2', position: 3000 },
  { name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 4000 },
] as const;

type Row = typeof releasePipeline.$inferSelect;

// The first team key by key order, for the pipeline's page URL.
export async function firstTeamKey(pipelineId: string): Promise<string | null> {
  const [row] = await db
    .select({ key: team.key })
    .from(releasePipelineTeam)
    .innerJoin(team, eq(team.id, releasePipelineTeam.teamId))
    .where(eq(releasePipelineTeam.pipelineId, pipelineId))
    .orderBy(asc(team.key))
    .limit(1);
  return row?.key ?? null;
}

// The first team key (alphabetical) of each pipeline, for many pipelines at once.
export async function firstTeamKeys(pipelineIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pipelineIds.length === 0) return out;
  const rows = await db
    .select({ pipelineId: releasePipelineTeam.pipelineId, key: team.key })
    .from(releasePipelineTeam)
    .innerJoin(team, eq(team.id, releasePipelineTeam.teamId))
    .where(inArray(releasePipelineTeam.pipelineId, [...pipelineIds]))
    .orderBy(asc(team.key));
  for (const r of rows) if (!out.has(r.pipelineId)) out.set(r.pipelineId, r.key);
  return out;
}

export async function pipelinesByIds(ids: readonly string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(releasePipeline)
    .where(inArray(releasePipeline.id, [...ids]));
}

export const pipelineUrl = (teamKey: string | null, slugId: string) =>
  `${trustedOrigins[0]}/team/${teamKey ?? ''}/releases/${slugId}`;

export function mapPipeline(row: Row): PipelineDto {
  return {
    id: row.id,
    slugId: row.slugId,
    name: row.name,
    type: row.type as PipelineType,
    isProduction: row.isProduction,
    includePathPatterns: row.includePathPatterns,
    rolloverIssuesOnCompletion: row.rolloverIssuesOnCompletion,
    autoGenerateReleaseNotesOnCompletion: row.autoGenerateReleaseNotesOnCompletion,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    trashed: row.trashed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// The name lowercased with other characters as "-", at most 40 characters.
export function slugBase(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || fallback
  );
}

// The requested slug, or the name's; a slug in use gets a 6-character suffix.
async function freeSlug(wanted: string, exceptId?: string): Promise<string> {
  const [taken] = await db
    .select({ id: releasePipeline.id })
    .from(releasePipeline)
    .where(eq(releasePipeline.slugId, wanted));
  if (!taken || taken.id === exceptId) return wanted;
  return `${wanted}-${randomBytes(3).toString('hex')}`;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  const name = value.trim();
  if (name.length > 255) throw new HttpError(400, 'name is at most 255 characters');
  return name;
}

function cleanType(value: unknown): PipelineType {
  if (!TYPES.includes(value as PipelineType))
    throw new HttpError(400, 'type must be continuous or scheduled');
  return value as PipelineType;
}

function cleanPatterns(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((p) => typeof p !== 'string' || !p.trim()))
    throw new HttpError(400, 'includePathPatterns must be a list of patterns');
  if (value.length > 50) throw new HttpError(400, 'includePathPatterns has at most 50 patterns');
  return value.map((p: string) => p.trim());
}

// The given teams, each one the user can see; at least one.
async function cleanTeamIds(user: AuthUser, value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0)
    throw new HttpError(400, 'teamIds must name at least one team');
  const ids = [...new Set(value as string[])];
  const visible = await db
    .select({ id: team.id })
    .from(team)
    .where(and(inArray(team.id, ids), inArray(team.id, visibleTeamIds(user.id))));
  if (visible.length !== ids.length) throw new HttpError(404, 'Team not found');
  return ids;
}

export async function createPipeline(
  actor: AuthUser | undefined | null,
  input: PipelineInput,
): Promise<PipelineDto> {
  const user = await assertWorkspaceRole(actor, 'member');
  const name = cleanName(input.name);
  const teamIds = await cleanTeamIds(user, input.teamIds);
  const slugId = await freeSlug(slugBase(input.slugId ?? name, 'pipeline'));
  const row = await db.transaction(async (tx) => {
    let created: Row;
    try {
      [created] = (await tx
        .insert(releasePipeline)
        .values({
          ...(input.id ? { id: input.id } : {}),
          slugId,
          name,
          type: input.type === undefined ? 'continuous' : cleanType(input.type),
          isProduction: input.isProduction ?? true,
          includePathPatterns:
            input.includePathPatterns === undefined ? [] : cleanPatterns(input.includePathPatterns),
          rolloverIssuesOnCompletion: input.rolloverIssuesOnCompletion ?? true,
          autoGenerateReleaseNotesOnCompletion: input.autoGenerateReleaseNotesOnCompletion ?? false,
        })
        .returning()) as [Row];
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new HttpError(409, 'The id or slug is already used');
      throw err;
    }
    await tx
      .insert(releasePipelineTeam)
      .values(teamIds.map((teamId) => ({ pipelineId: created.id, teamId })));
    await tx
      .insert(releaseStage)
      .values(DEFAULT_STAGES.map((s) => ({ ...s, pipelineId: created.id })));
    return created;
  });
  return mapPipeline(row);
}

export async function updatePipeline(
  actor: AuthUser | undefined | null,
  id: string,
  input: PipelineInput,
): Promise<PipelineDto> {
  const current = await assertPipelineWrite(actor, id);
  const user = actor!;
  const set: Partial<typeof releasePipeline.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = cleanName(input.name);
  if (input.slugId !== undefined)
    set.slugId = await freeSlug(slugBase(input.slugId, 'pipeline'), current.id);
  if (input.type !== undefined) set.type = cleanType(input.type);
  if (input.isProduction !== undefined) set.isProduction = !!input.isProduction;
  if (input.includePathPatterns !== undefined)
    set.includePathPatterns = cleanPatterns(input.includePathPatterns);
  if (input.rolloverIssuesOnCompletion !== undefined)
    set.rolloverIssuesOnCompletion = !!input.rolloverIssuesOnCompletion;
  if (input.autoGenerateReleaseNotesOnCompletion !== undefined)
    set.autoGenerateReleaseNotesOnCompletion = !!input.autoGenerateReleaseNotesOnCompletion;
  const teamIds = input.teamIds === undefined ? null : await cleanTeamIds(user, input.teamIds);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(releasePipeline)
      .set(set)
      .where(eq(releasePipeline.id, id))
      .returning();
    if (teamIds) {
      await tx.delete(releasePipelineTeam).where(eq(releasePipelineTeam.pipelineId, id));
      await tx
        .insert(releasePipelineTeam)
        .values(teamIds.map((teamId) => ({ pipelineId: id, teamId })));
    }
    return updated!;
  });
  return mapPipeline(row);
}

async function setArchived(
  actor: AuthUser | undefined | null,
  id: string,
  state: { archived: boolean; trashed: boolean },
): Promise<PipelineDto> {
  await assertPipelineWrite(actor, id);
  const [row] = await db
    .update(releasePipeline)
    .set({
      archivedAt: state.archived ? new Date() : null,
      trashed: state.trashed,
      updatedAt: new Date(),
    })
    .where(eq(releasePipeline.id, id))
    .returning();
  return mapPipeline(row!);
}

export const archivePipeline = (actor: AuthUser | undefined | null, id: string) =>
  setArchived(actor, id, { archived: true, trashed: false });
export const deletePipeline = (actor: AuthUser | undefined | null, id: string) =>
  setArchived(actor, id, { archived: true, trashed: true });
export const unarchivePipeline = (actor: AuthUser | undefined | null, id: string) =>
  setArchived(actor, id, { archived: false, trashed: false });

export async function getPipeline(
  actor: AuthUser | undefined | null,
  id: string,
): Promise<PipelineDto> {
  return mapPipeline(await assertPipelineRead(actor, id));
}

// SQL condition for pipeline lists: visible, never trashed, archived only on request.
export function listablePipelinesSql(userId: string, includeArchived: boolean): SQL {
  return and(
    visiblePipelinesSql(userId),
    eq(releasePipeline.trashed, false),
    includeArchived ? undefined : isNull(releasePipeline.archivedAt),
  )!;
}

// The ids of the pipeline's teams the user can see.
export async function pipelineTeamIds(pipelineId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: releasePipelineTeam.teamId })
    .from(releasePipelineTeam)
    .where(
      and(
        eq(releasePipelineTeam.pipelineId, pipelineId),
        inArray(releasePipelineTeam.teamId, visibleTeamIds(userId)),
      ),
    );
  return rows.map((r) => r.id);
}

// Active releases of the pipeline (Linear's approximateReleaseCount).
export async function pipelineReleaseCount(pipelineId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(release)
    .where(and(eq(release.pipelineId, pipelineId), isNull(release.archivedAt)));
  return row?.n ?? 0;
}
