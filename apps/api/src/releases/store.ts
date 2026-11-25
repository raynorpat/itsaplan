import {
  db,
  issue,
  issueToRelease,
  release,
  releaseDocument,
  releaseLink,
  releaseNote,
  releaseNoteRelease,
  releasePipeline,
  releaseStage,
  workflowState,
} from '@repo/db';
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { type AuthUser } from '../shared/access';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import { assertPipelineRead, assertPipelineWrite, visiblePipelinesSql } from './access';
import { firstTeamKey, pipelineUrl, slugBase } from './pipelines';
import { type StageType } from './stages';

// Releases (Linear's Release): a release belongs to one pipeline and is in one of its
// stages. Moving a release to a stage sets the stage's time (started, completed,
// canceled). Completing a scheduled release whose pipeline rolls issues over moves its
// open issues (not completed or canceled) to the next planned release, created as
// "Next" when there is none. Deleting trashes (archived and `trashed`), as Linear does.

export interface ReleaseDto {
  id: string;
  slugId: string;
  pipelineId: string;
  stageId: string;
  name: string;
  version: string | null;
  description: string | null;
  commitSha: string | null;
  startDate: string | null;
  targetDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  creatorId: string | null;
  archivedAt: string | null;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseInput {
  id?: string;
  pipelineId?: string;
  stageId?: string;
  name?: string;
  version?: string | null;
  description?: string | null;
  commitSha?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  trashed?: boolean;
}

// Links, documents and release notes given with a release (Linear's ReleaseLinkInput,
// ReleaseDocumentInput, ReleaseNoteInput). Invalid entries are skipped, as Linear's
// sync skips them.
export interface ReleaseContent {
  links?: { url?: unknown; label?: unknown }[] | null;
  documents?: { title?: unknown; content?: unknown }[] | null;
  releaseNotes?: { title?: unknown; content?: unknown } | null;
}

type Row = typeof release.$inferSelect;
type PipelineRow = typeof releasePipeline.$inferSelect;
type StageRow = typeof releaseStage.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const isoOrNull = (d: Date | null) => (d ? iso(d) : null);

export function mapRelease(row: Row): ReleaseDto {
  return {
    id: row.id,
    slugId: row.slugId,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    name: row.name,
    version: row.version,
    description: row.description,
    commitSha: row.commitSha,
    startDate: row.startDate,
    targetDate: row.targetDate,
    startedAt: isoOrNull(row.startedAt),
    completedAt: isoOrNull(row.completedAt),
    canceledAt: isoOrNull(row.canceledAt),
    creatorId: row.creatorId,
    archivedAt: isoOrNull(row.archivedAt),
    trashed: row.trashed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// The release's web page: under its pipeline's page.
export async function releaseUrl(r: Pick<ReleaseDto, 'pipelineId' | 'slugId'>): Promise<string> {
  const [p] = await db
    .select({ slugId: releasePipeline.slugId })
    .from(releasePipeline)
    .where(eq(releasePipeline.id, r.pipelineId));
  return `${pipelineUrl(await firstTeamKey(r.pipelineId), p?.slugId ?? '')}/${r.slugId}`;
}

// SQL condition on `release`: releases of pipelines the user may read.
export const visibleReleasesSql = (userId: string): SQL =>
  sql`${release.pipelineId} IN (SELECT ${releasePipeline.id} FROM ${releasePipeline} WHERE ${visiblePipelinesSql(userId)})`;

// SQL condition for release lists: visible, never trashed, archived only on request.
export function listableReleasesSql(userId: string, includeArchived: boolean): SQL {
  return and(
    visibleReleasesSql(userId),
    eq(release.trashed, false),
    includeArchived ? undefined : isNull(release.archivedAt),
  )!;
}

// The release (archived and trashed included) when the user may read its pipeline.
export async function assertReleaseRead(
  user: AuthUser | undefined | null,
  id: string,
): Promise<Row> {
  const notFound = new HttpError(404, `Release ${id} not found`);
  if (!UUID_RE.test(id)) throw notFound;
  const [row] = await db.select().from(release).where(eq(release.id, id));
  if (!row) throw notFound;
  try {
    await assertPipelineRead(user, row.pipelineId);
  } catch {
    throw notFound;
  }
  return row;
}

async function assertReleaseWrite(
  user: AuthUser | undefined | null,
  id: string,
): Promise<{ row: Row; pipeline: PipelineRow }> {
  const row = await assertReleaseRead(user, id);
  return { row, pipeline: await assertPipelineWrite(user, row.pipelineId) };
}

export async function getRelease(user: AuthUser | undefined | null, id: string) {
  return mapRelease(await assertReleaseRead(user, id));
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  if (value.trim().length > 255) throw new HttpError(400, 'name is at most 255 characters');
  return value.trim();
}

function cleanText(value: unknown, what: string, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${what} must be a string`);
  if (value.length > max) throw new HttpError(400, `${what} is at most ${max} characters`);
  return value;
}

function cleanDate(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(400, `${what} must be a date (YYYY-MM-DD)`);
  return value;
}

function cleanTime(value: unknown, what: string): Date | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value as string);
  if (typeof value !== 'string' || Number.isNaN(d.getTime()))
    throw new HttpError(400, `${what} must be a date and time`);
  return d;
}

// The release slug: the name's, with a 6-character suffix when it is taken.
async function freeReleaseSlug(name: string, runner: Tx | typeof db = db): Promise<string> {
  const wanted = slugBase(name, 'release');
  const [taken] = await runner
    .select({ id: release.id })
    .from(release)
    .where(eq(release.slugId, wanted));
  return taken ? `${wanted}-${randomBytes(3).toString('hex')}` : wanted;
}

async function stagesOf(pipelineId: string, runner: Tx | typeof db = db): Promise<StageRow[]> {
  return runner
    .select()
    .from(releaseStage)
    .where(and(eq(releaseStage.pipelineId, pipelineId), isNull(releaseStage.archivedAt)))
    .orderBy(asc(releaseStage.position), asc(releaseStage.createdAt));
}

// The pipeline's first active stage of a type.
export async function stageOfType(
  pipelineId: string,
  type: StageType,
  runner: Tx | typeof db = db,
): Promise<StageRow> {
  const stage = (await stagesOf(pipelineId, runner)).find((s) => s.type === type);
  if (!stage) throw new HttpError(400, `The pipeline has no ${type} stage`);
  return stage;
}

async function stageOfPipeline(pipelineId: string, stageId: unknown): Promise<StageRow> {
  if (typeof stageId !== 'string' || !UUID_RE.test(stageId))
    throw new HttpError(400, 'stageId must be a stage of the pipeline');
  const [stage] = await db
    .select()
    .from(releaseStage)
    .where(
      and(
        eq(releaseStage.id, stageId),
        eq(releaseStage.pipelineId, pipelineId),
        isNull(releaseStage.archivedAt),
      ),
    );
  if (!stage) throw new HttpError(400, 'stageId must be a stage of the pipeline');
  return stage;
}

// The times a move to `stage` sets, from the release's current ones. Reopening a
// completed or canceled release clears those times.
function stageTimes(
  stage: StageRow,
  current: Pick<Row, 'startedAt' | 'completedAt' | 'canceledAt'>,
  now: Date,
): Pick<Row, 'startedAt' | 'completedAt' | 'canceledAt'> {
  switch (stage.type as StageType) {
    case 'planned':
      return { startedAt: current.startedAt, completedAt: null, canceledAt: null };
    case 'started':
      return { startedAt: current.startedAt ?? now, completedAt: null, canceledAt: null };
    case 'completed':
      return {
        startedAt: current.startedAt ?? now,
        completedAt: current.completedAt ?? now,
        canceledAt: null,
      };
    case 'canceled':
      return {
        startedAt: current.startedAt,
        completedAt: current.completedAt,
        canceledAt: current.canceledAt ?? now,
      };
  }
}

function rethrowVersion(err: unknown): never {
  if (pgErrorCode(err) === '23505')
    throw new HttpError(409, 'The id, or the version in this pipeline, is already used');
  throw err;
}

// Linear's releaseCreate. Without a stage: the pipeline's completed stage for a
// continuous pipeline, its first started stage for a scheduled one.
export async function createRelease(
  user: AuthUser | undefined | null,
  input: ReleaseInput,
): Promise<ReleaseDto> {
  if (typeof input.pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
  const pipeline = await assertPipelineWrite(user, input.pipelineId);
  const name = cleanName(input.name);
  const stage =
    input.stageId !== undefined && input.stageId !== null
      ? await stageOfPipeline(pipeline.id, input.stageId)
      : await stageOfType(pipeline.id, pipeline.type === 'continuous' ? 'completed' : 'started');
  const now = new Date();
  const createdAt = cleanTime(input.createdAt, 'createdAt');
  if (createdAt && createdAt.getTime() > now.getTime())
    throw new HttpError(400, 'createdAt must be in the past');
  const times = stageTimes(stage, { startedAt: null, completedAt: null, canceledAt: null }, now);
  const startedAt = cleanTime(input.startedAt, 'startedAt');
  const completedAt = cleanTime(input.completedAt, 'completedAt');
  let row: Row;
  try {
    [row] = (await db
      .insert(release)
      .values({
        ...(input.id ? { id: input.id } : {}),
        slugId: await freeReleaseSlug(name),
        pipelineId: pipeline.id,
        stageId: stage.id,
        name,
        version: cleanText(input.version, 'version', 255),
        description: cleanText(input.description, 'description', 100_000),
        commitSha: cleanText(input.commitSha, 'commitSha', 64),
        startDate: cleanDate(input.startDate, 'startDate'),
        targetDate: cleanDate(input.targetDate, 'targetDate'),
        startedAt: startedAt ?? times.startedAt,
        completedAt: times.completedAt ? (completedAt ?? times.completedAt) : null,
        canceledAt: times.canceledAt,
        creatorId: user?.id ?? null,
        ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
      })
      .returning()) as [Row];
  } catch (err) {
    rethrowVersion(err);
  }
  return mapRelease(row);
}

// Moves the release to `stage` inside `tx`, setting the stage's times; completing a
// scheduled release whose pipeline rolls issues over moves its open issues on.
async function moveToStage(
  tx: Tx,
  current: Row,
  pipeline: PipelineRow,
  stage: StageRow,
  extra: Partial<typeof release.$inferInsert> = {},
): Promise<Row> {
  const now = new Date();
  const [row] = await tx
    .update(release)
    .set({ ...stageTimes(stage, current, now), ...extra, stageId: stage.id, updatedAt: now })
    .where(eq(release.id, current.id))
    .returning();
  const completing = stage.type === 'completed' && current.completedAt === null;
  if (completing && pipeline.type === 'scheduled' && pipeline.rolloverIssuesOnCompletion)
    await rollover(tx, row!, pipeline);
  return row!;
}

// Moves the release's open issues to the planned release with the earliest target
// date (then the oldest), or to a new planned release named "Next".
async function rollover(tx: Tx, completed: Row, pipeline: PipelineRow): Promise<void> {
  const open = await tx
    .select({ issueId: issueToRelease.issueId })
    .from(issueToRelease)
    .innerJoin(issue, eq(issue.id, issueToRelease.issueId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        eq(issueToRelease.releaseId, completed.id),
        notInArray(workflowState.stateType, ['completed', 'canceled']),
      ),
    );
  if (open.length === 0) return;
  const ids = open.map((o) => o.issueId);
  const [next] = await tx
    .select({ id: release.id })
    .from(release)
    .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
    .where(
      and(
        eq(release.pipelineId, pipeline.id),
        ne(release.id, completed.id),
        eq(releaseStage.type, 'planned'),
        isNull(release.archivedAt),
        eq(release.trashed, false),
      ),
    )
    .orderBy(sql`${release.targetDate} ASC NULLS LAST`, asc(release.createdAt))
    .limit(1);
  let targetId = next?.id;
  if (!targetId) {
    const planned = await stageOfType(pipeline.id, 'planned', tx);
    const [created] = await tx
      .insert(release)
      .values({
        slugId: await freeReleaseSlug('Next', tx),
        pipelineId: pipeline.id,
        stageId: planned.id,
        name: 'Next',
        creatorId: completed.creatorId,
      })
      .returning({ id: release.id });
    targetId = created!.id;
  }
  // An issue already in the target keeps that link; the completed release's goes.
  await tx
    .delete(issueToRelease)
    .where(
      and(
        eq(issueToRelease.releaseId, completed.id),
        inArray(issueToRelease.issueId, ids),
        inArray(
          issueToRelease.issueId,
          tx
            .select({ id: issueToRelease.issueId })
            .from(issueToRelease)
            .where(eq(issueToRelease.releaseId, targetId)),
        ),
      ),
    );
  await tx
    .update(issueToRelease)
    .set({ releaseId: targetId, createdAt: sql`now()` })
    .where(and(eq(issueToRelease.releaseId, completed.id), inArray(issueToRelease.issueId, ids)));
}

// Linear's releaseUpdate. `trashed` true trashes the release, false restores it.
export async function updateRelease(
  user: AuthUser | undefined | null,
  id: string,
  input: ReleaseInput,
): Promise<ReleaseDto> {
  const { row: current, pipeline } = await assertReleaseWrite(user, id);
  const set: Partial<typeof release.$inferInsert> = {};
  if (input.name !== undefined) set.name = cleanName(input.name);
  if (input.version !== undefined) set.version = cleanText(input.version, 'version', 255);
  if (input.description !== undefined)
    set.description = cleanText(input.description, 'description', 100_000);
  if (input.commitSha !== undefined) set.commitSha = cleanText(input.commitSha, 'commitSha', 64);
  if (input.startDate !== undefined) set.startDate = cleanDate(input.startDate, 'startDate');
  if (input.targetDate !== undefined) set.targetDate = cleanDate(input.targetDate, 'targetDate');
  if (input.startedAt !== undefined) set.startedAt = cleanTime(input.startedAt, 'startedAt');
  if (input.completedAt !== undefined)
    set.completedAt = cleanTime(input.completedAt, 'completedAt');
  if (input.trashed !== undefined) {
    set.trashed = !!input.trashed;
    set.archivedAt = input.trashed ? new Date() : null;
  }
  const stage =
    input.stageId !== undefined && input.stageId !== current.stageId
      ? await stageOfPipeline(pipeline.id, input.stageId)
      : null;
  try {
    const row = await db.transaction(async (tx) => {
      if (stage) return moveToStage(tx, current, pipeline, stage, set);
      const [updated] = await tx
        .update(release)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(release.id, id))
        .returning();
      return updated!;
    });
    return mapRelease(row);
  } catch (err) {
    rethrowVersion(err);
  }
}

async function setArchived(
  user: AuthUser | undefined | null,
  id: string,
  state: { archived: boolean; trashed: boolean },
): Promise<ReleaseDto> {
  await assertReleaseWrite(user, id);
  const [row] = await db
    .update(release)
    .set({
      archivedAt: state.archived ? new Date() : null,
      trashed: state.trashed,
      updatedAt: new Date(),
    })
    .where(eq(release.id, id))
    .returning();
  return mapRelease(row!);
}

export const archiveRelease = (user: AuthUser | undefined | null, id: string) =>
  setArchived(user, id, { archived: true, trashed: false });
export const deleteRelease = (user: AuthUser | undefined | null, id: string) =>
  setArchived(user, id, { archived: true, trashed: true });
export const unarchiveRelease = (user: AuthUser | undefined | null, id: string) =>
  setArchived(user, id, { archived: false, trashed: false });

const activeReleaseOf = (pipelineId: string) =>
  and(eq(release.pipelineId, pipelineId), isNull(release.archivedAt), eq(release.trashed, false));

// The release a by-pipeline operation acts on: the one with `version`, else (when
// `fallback` allows) the latest started release, else the planned release with the
// earliest target date. Null when there is none.
export async function releaseForPipeline(
  pipelineId: string,
  version: string | null | undefined,
  fallback: { planned: boolean },
  runner: Tx | typeof db = db,
): Promise<Row | null> {
  if (version) {
    const [byVersion] = await runner
      .select()
      .from(release)
      .where(and(activeReleaseOf(pipelineId), eq(release.version, version)));
    return byVersion ?? null;
  }
  const [started] = await runner
    .select({ r: release })
    .from(release)
    .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
    .where(and(activeReleaseOf(pipelineId), eq(releaseStage.type, 'started')))
    .orderBy(desc(release.startedAt), desc(release.createdAt))
    .limit(1);
  if (started) return started.r;
  if (!fallback.planned) return null;
  const [planned] = await runner
    .select({ r: release })
    .from(release)
    .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
    .where(and(activeReleaseOf(pipelineId), eq(releaseStage.type, 'planned')))
    .orderBy(sql`${release.targetDate} ASC NULLS LAST`, asc(release.createdAt))
    .limit(1);
  return planned?.r ?? null;
}

const HTTP_URL = /^https?:\/\/[^\s]+$/i;

// Upserts the given links (by URL), documents (by title) and release notes (the note
// that covers only this release) of the release. Invalid entries are skipped.
export async function applyReleaseContent(
  tx: Tx,
  releaseRow: Pick<Row, 'id' | 'pipelineId'>,
  content: ReleaseContent,
): Promise<void> {
  for (const l of content.links ?? []) {
    if (typeof l.url !== 'string' || !HTTP_URL.test(l.url) || l.url.length > 2048) continue;
    const label = typeof l.label === 'string' && l.label.trim() ? l.label.slice(0, 255) : null;
    await tx
      .insert(releaseLink)
      .values({ releaseId: releaseRow.id, url: l.url, label })
      .onConflictDoUpdate({ target: [releaseLink.releaseId, releaseLink.url], set: { label } });
  }
  for (const d of content.documents ?? []) {
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 255) continue;
    if (typeof d.content !== 'string' || d.content.length > 200_000) continue;
    await tx
      .insert(releaseDocument)
      .values({ releaseId: releaseRow.id, title: d.title.trim(), content: d.content })
      .onConflictDoUpdate({
        target: [releaseDocument.releaseId, releaseDocument.title],
        set: { content: d.content, updatedAt: new Date() },
      });
  }
  const note = content.releaseNotes;
  if (note && typeof note.content === 'string' && note.content.length <= 200_000) {
    const title = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : null;
    // The note covering this release and no other.
    const [own] = await tx
      .select({ id: releaseNote.id })
      .from(releaseNote)
      .innerJoin(releaseNoteRelease, eq(releaseNoteRelease.noteId, releaseNote.id))
      .where(eq(releaseNoteRelease.releaseId, releaseRow.id))
      .groupBy(releaseNote.id)
      .having(
        sql`(SELECT count(*) FROM ${releaseNoteRelease} r2 WHERE r2.note_id = ${releaseNote.id}) = 1`,
      )
      .limit(1);
    if (own) {
      await tx
        .update(releaseNote)
        .set({ title, content: note.content, updatedAt: new Date() })
        .where(eq(releaseNote.id, own.id));
    } else {
      const [created] = await tx
        .insert(releaseNote)
        .values({
          slugId: randomBytes(6).toString('hex'),
          pipelineId: releaseRow.pipelineId,
          title,
          content: note.content,
        })
        .returning({ id: releaseNote.id });
      await tx.insert(releaseNoteRelease).values({ noteId: created!.id, releaseId: releaseRow.id });
    }
  }
}

export interface ByPipelineInput extends ReleaseContent {
  pipelineId?: string;
  version?: string | null;
  name?: string | null;
  description?: string | null;
  stage?: string | null;
}

// Linear's releaseUpdateByPipeline: finds the release (by version, else the latest
// started, else the earliest planned), applies the fields and content, and moves it
// to the stage named `stage` (any case).
export async function updateReleaseByPipeline(
  user: AuthUser | undefined | null,
  input: ByPipelineInput,
): Promise<ReleaseDto> {
  if (typeof input.pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
  const pipeline = await assertPipelineWrite(user, input.pipelineId);
  return mapRelease(await updateByPipeline(pipeline, input));
}

// The by-pipeline update for a pipeline already authorized (also used by access keys).
export async function updateByPipeline(
  pipeline: PipelineRow,
  input: ByPipelineInput,
): Promise<Row> {
  const current = await releaseForPipeline(pipeline.id, input.version, { planned: true });
  if (!current) throw new HttpError(404, 'No release of the pipeline matches');
  let stage: StageRow | null = null;
  if (input.stage) {
    const wanted = input.stage.trim().toLowerCase();
    stage = (await stagesOf(pipeline.id)).find((s) => s.name.toLowerCase() === wanted) ?? null;
    if (!stage) throw new HttpError(400, `The pipeline has no stage named ${input.stage}`);
  }
  const set: Partial<typeof release.$inferInsert> = {};
  if (input.name !== undefined && input.name !== null) set.name = cleanName(input.name);
  if (input.description !== undefined)
    set.description = cleanText(input.description, 'description', 100_000);
  return db.transaction(async (tx) => {
    let row: Row;
    if (stage && stage.id !== current.stageId)
      row = await moveToStage(tx, current, pipeline, stage, set);
    else {
      const [updated] = await tx
        .update(release)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(release.id, current.id))
        .returning();
      row = updated!;
    }
    await applyReleaseContent(tx, row, input);
    return row;
  });
}

export interface CompleteInput extends ReleaseContent {
  pipelineId?: string;
  version?: string | null;
  name?: string | null;
  description?: string | null;
  commitSha?: string | null;
}

// Linear's releaseComplete: completes the release with `version`, or the latest
// started release. With a version an existing commit SHA is kept; without one the SHA
// replaces the started release's, and a retry (no started release, one already
// completed with that SHA) returns the completed release.
export async function completeReleaseByPipeline(
  user: AuthUser | undefined | null,
  input: CompleteInput,
): Promise<ReleaseDto> {
  if (typeof input.pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
  const pipeline = await assertPipelineWrite(user, input.pipelineId);
  return mapRelease(await completeByPipeline(pipeline, input));
}

// The completion for a pipeline already authorized (also used by access keys).
export async function completeByPipeline(
  pipeline: PipelineRow,
  input: CompleteInput,
): Promise<Row> {
  const sha = cleanText(input.commitSha, 'commitSha', 64);
  let current = await releaseForPipeline(pipeline.id, input.version, { planned: false });
  if (!current && !input.version && sha) {
    const [retry] = await db
      .select()
      .from(release)
      .where(
        and(
          activeReleaseOf(pipeline.id),
          eq(release.commitSha, sha),
          sql`${release.completedAt} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (retry) return retry;
  }
  if (!current) throw new HttpError(404, 'No release of the pipeline to complete');
  const completed = await stageOfType(pipeline.id, 'completed');
  const set: Partial<typeof release.$inferInsert> = {};
  if (input.name !== undefined && input.name !== null) set.name = cleanName(input.name);
  if (input.description !== undefined)
    set.description = cleanText(input.description, 'description', 100_000);
  if (sha && (!input.version || !current.commitSha)) set.commitSha = sha;
  return db.transaction(async (tx) => {
    current = current!;
    const row =
      current.stageId === completed.id
        ? (
            await tx
              .update(release)
              .set({ ...set, updatedAt: new Date() })
              .where(eq(release.id, current.id))
              .returning()
          )[0]!
        : await moveToStage(tx, current, pipeline, completed, set);
    await applyReleaseContent(tx, row, input);
    return row;
  });
}

// Releases matching `term` in their name, version or pipeline name (any case), or all
// when there is no term; started first, then planned, completed and canceled.
export function searchOrder(): SQL[] {
  return [
    sql`CASE ${releaseStage.type} WHEN 'started' THEN 0 WHEN 'planned' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`,
    desc(release.updatedAt),
  ];
}

export function searchTermSql(term: string | null | undefined): SQL | undefined {
  if (!term || !term.trim()) return undefined;
  const pattern = `%${term.trim().replace(/[\\%_]/g, '\\$&')}%`;
  return sql`(${release.name} ILIKE ${pattern} OR ${release.version} ILIKE ${pattern} OR ${releasePipeline.name} ILIKE ${pattern})`;
}
