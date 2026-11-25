import { randomBytes } from 'node:crypto';
import {
  db,
  issue,
  issueLabel,
  issueToRelease,
  label,
  release,
  releaseNote,
  releaseNoteRelease,
  releasePipeline,
  team,
  workflowState,
} from '@repo/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { visibleTeamIds, type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { assertPipelineRead, assertPipelineWrite, visiblePipelinesSql } from './access';

// Linear's ReleaseNote: Markdown covering one or more releases of one pipeline
// (`release_note`, `release_note_release`). A note is read by whoever reads its
// pipeline and changed by whoever may change it. A scheduled pipeline's note covers
// exactly one release. "Fill from issues" (`draftNoteContent`) lists a release's
// completed issues grouped by label; a pipeline with
// `autoGenerateReleaseNotesOnCompletion` gets that draft when a release completes
// without a note (`autoDraftNote`).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Runner = Tx | typeof db;
type NoteRow = typeof releaseNote.$inferSelect;
type ReleaseRow = typeof release.$inferSelect;
type PipelineRow = typeof releasePipeline.$inferSelect;

export interface ReleaseNoteDto {
  id: string;
  slugId: string;
  pipelineId: string;
  title: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: null;
}

export interface NoteInput {
  id?: unknown;
  pipelineId?: unknown;
  releaseIds?: unknown;
  rangeFromReleaseId?: unknown;
  rangeToReleaseId?: unknown;
  title?: unknown;
  content?: unknown;
}

const MAX_CONTENT = 200_000;
const MAX_TITLE = 255;

export function mapNote(row: NoteRow): ReleaseNoteDto {
  return {
    id: row.id,
    slugId: row.slugId,
    pipelineId: row.pipelineId,
    title: row.title,
    content: row.content,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: null,
  };
}

// SQL condition on `release_note`: notes of pipelines the user may read.
export const visibleNotesSql = (userId: string): SQL =>
  sql`${releaseNote.pipelineId} IN (SELECT ${releasePipeline.id} FROM ${releasePipeline}
    WHERE ${visiblePipelinesSql(userId)})`;

// Releases ordered as Linear orders a note's range: by completion, then creation.
const releaseOrder = sql`coalesce(${release.completedAt}, ${release.createdAt})`;

const freeSlug = () => randomBytes(6).toString('hex');

function cleanContent(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) return '';
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, 'content must be a string');
  if (value.length > MAX_CONTENT)
    throw new HttpError(400, `content must be at most ${MAX_CONTENT} characters`);
  return value;
}

// A custom title; an empty string or null restores the title derived from the releases.
function cleanTitle(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'title must be a string');
  const title = value.trim();
  if (title.length > MAX_TITLE)
    throw new HttpError(400, `title must be at most ${MAX_TITLE} characters`);
  return title || null;
}

// The release ids a note covers, from `releaseIds` or a range, all active releases of
// the pipeline; a scheduled pipeline's note covers exactly one.
async function coveredReleases(
  pipeline: PipelineRow,
  input: NoteInput,
  required: boolean,
): Promise<string[] | undefined> {
  const from = input.rangeFromReleaseId;
  const to = input.rangeToReleaseId;
  let ids: string[] | undefined;
  if (input.releaseIds !== undefined && input.releaseIds !== null) {
    if (
      !Array.isArray(input.releaseIds) ||
      input.releaseIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    )
      throw new HttpError(400, 'releaseIds must be release ids');
    ids = [...new Set(input.releaseIds as string[])];
    if (ids.length === 0) throw new HttpError(400, 'releaseIds must name at least one release');
    const found = await db
      .select({ id: release.id })
      .from(release)
      .where(
        and(
          inArray(release.id, ids),
          eq(release.pipelineId, pipeline.id),
          eq(release.trashed, false),
        ),
      );
    if (found.length !== ids.length)
      throw new HttpError(400, 'releaseIds must name releases of the pipeline');
  } else if (from !== undefined && from !== null) {
    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !UUID_RE.test(from) ||
      !UUID_RE.test(to)
    )
      throw new HttpError(400, 'rangeFromReleaseId and rangeToReleaseId must be release ids');
    const ends = await db
      .select({ id: release.id, at: releaseOrder })
      .from(release)
      .where(and(inArray(release.id, [from, to]), eq(release.pipelineId, pipeline.id)));
    if (ends.length !== (from === to ? 1 : 2))
      throw new HttpError(400, 'The range must name releases of the pipeline');
    const times = ends.map((e) => new Date(e.at as unknown as string));
    const low = new Date(Math.min(...times.map((t) => t.getTime())));
    const high = new Date(Math.max(...times.map((t) => t.getTime())));
    const rows = await db
      .select({ id: release.id })
      .from(release)
      .where(
        and(
          eq(release.pipelineId, pipeline.id),
          isNull(release.archivedAt),
          eq(release.trashed, false),
          gte(releaseOrder, low),
          lte(releaseOrder, high),
        ),
      );
    ids = rows.map((r) => r.id);
  } else if (to !== undefined && to !== null) {
    throw new HttpError(400, 'rangeToReleaseId needs rangeFromReleaseId');
  } else if (required) {
    throw new HttpError(400, 'releaseIds or a release range is required');
  }
  if (ids && pipeline.type === 'scheduled' && ids.length !== 1)
    throw new HttpError(400, 'A note of a scheduled pipeline covers exactly one release');
  return ids;
}

async function assertNoteRead(user: AuthUser | undefined | null, id: string): Promise<NoteRow> {
  const notFound = new HttpError(404, `Release note ${id} not found`);
  if (!UUID_RE.test(id)) throw notFound;
  const [row] = await db.select().from(releaseNote).where(eq(releaseNote.id, id));
  if (!row) throw notFound;
  try {
    await assertPipelineRead(user, row.pipelineId);
  } catch {
    throw notFound;
  }
  return row;
}

export async function getNote(user: AuthUser | undefined | null, id: string) {
  return mapNote(await assertNoteRead(user, id));
}

export async function createNote(
  user: AuthUser | undefined | null,
  input: NoteInput,
): Promise<ReleaseNoteDto> {
  if (typeof input.pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
  const pipeline = await assertPipelineWrite(user, input.pipelineId);
  if (input.id !== undefined && (typeof input.id !== 'string' || !UUID_RE.test(input.id)))
    throw new HttpError(400, 'id must be a UUID');
  const ids = (await coveredReleases(pipeline, input, true))!;
  const title = cleanTitle(input.title) ?? null;
  const content = cleanContent(input.content, true)!;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(releaseNote)
      .values({
        ...(typeof input.id === 'string' ? { id: input.id } : {}),
        slugId: freeSlug(),
        pipelineId: pipeline.id,
        title,
        content,
      })
      .returning();
    await tx
      .insert(releaseNoteRelease)
      .values(ids.map((releaseId) => ({ noteId: created!.id, releaseId })));
    return created!;
  });
  return mapNote(row);
}

export async function updateNote(
  user: AuthUser | undefined | null,
  id: string,
  input: NoteInput,
): Promise<ReleaseNoteDto> {
  const current = await assertNoteRead(user, id);
  const pipeline = await assertPipelineWrite(user, current.pipelineId);
  const ids = await coveredReleases(pipeline, input, false);
  const set: Partial<typeof releaseNote.$inferInsert> = { updatedAt: new Date() };
  const title = cleanTitle(input.title);
  if (title !== undefined) set.title = title;
  const content = cleanContent(input.content, false);
  if (content !== undefined) set.content = content;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(releaseNote)
      .set(set)
      .where(eq(releaseNote.id, id))
      .returning();
    if (ids) {
      await tx.delete(releaseNoteRelease).where(eq(releaseNoteRelease.noteId, id));
      await tx
        .insert(releaseNoteRelease)
        .values(ids.map((releaseId) => ({ noteId: id, releaseId })));
    }
    return updated!;
  });
  return mapNote(row);
}

export async function deleteNote(user: AuthUser | undefined | null, id: string): Promise<string> {
  const current = await assertNoteRead(user, id);
  await assertPipelineWrite(user, current.pipelineId);
  await db.delete(releaseNote).where(eq(releaseNote.id, id));
  return id;
}

// The notes covering a release, oldest first.
export async function notesOfRelease(releaseId: string): Promise<ReleaseNoteDto[]> {
  const rows = await db
    .select({ n: releaseNote })
    .from(releaseNote)
    .innerJoin(releaseNoteRelease, eq(releaseNoteRelease.noteId, releaseNote.id))
    .where(eq(releaseNoteRelease.releaseId, releaseId))
    .orderBy(asc(releaseNote.createdAt), asc(releaseNote.id));
  return rows.map((r) => mapNote(r.n));
}

// The pipeline's most recently created note, or null.
export async function latestNoteOfPipeline(pipelineId: string): Promise<ReleaseNoteDto | null> {
  const [row] = await db
    .select()
    .from(releaseNote)
    .where(eq(releaseNote.pipelineId, pipelineId))
    .orderBy(desc(releaseNote.createdAt), desc(releaseNote.id))
    .limit(1);
  return row ? mapNote(row) : null;
}

// The releases a note covers, in range order (by completion, then creation).
export async function releasesOfNote(noteId: string): Promise<ReleaseRow[]> {
  const rows = await db
    .select({ r: release })
    .from(release)
    .innerJoin(releaseNoteRelease, eq(releaseNoteRelease.releaseId, release.id))
    .where(eq(releaseNoteRelease.noteId, noteId))
    .orderBy(asc(releaseOrder), asc(release.id));
  return rows.map((r) => r.r);
}

// "Fill from issues": the release's completed issues as Markdown sections by label
// ("Features" for a label named like feature or enhancement, then "Bug fixes" for bug
// or fix, then "Other"), each "- <title> (<identifier>)", empty sections left out.
// With `viewerId`, only issues of teams the viewer can see.
export async function draftNoteContent(
  releaseId: string,
  viewerId: string | null,
  runner: Runner = db,
): Promise<string> {
  const rows = await runner
    .select({
      id: issue.id,
      title: issue.title,
      key: team.key,
      number: issue.sequenceNumber,
    })
    .from(issueToRelease)
    .innerJoin(issue, eq(issue.id, issueToRelease.issueId))
    .innerJoin(team, eq(team.id, issue.teamId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        eq(issueToRelease.releaseId, releaseId),
        eq(workflowState.stateType, 'completed'),
        viewerId ? inArray(issue.teamId, visibleTeamIds(viewerId)) : undefined,
      ),
    )
    .orderBy(asc(team.key), asc(issue.sequenceNumber));
  if (rows.length === 0) return '';
  const labels = await runner
    .select({ issueId: issueLabel.issueId, name: label.name })
    .from(issueLabel)
    .innerJoin(label, eq(label.id, issueLabel.labelId))
    .where(
      inArray(
        issueLabel.issueId,
        rows.map((r) => r.id),
      ),
    );
  const namesOf = new Map<string, string[]>();
  for (const l of labels) namesOf.set(l.issueId, [...(namesOf.get(l.issueId) ?? []), l.name]);
  const sections: Record<'Features' | 'Bug fixes' | 'Other', string[]> = {
    Features: [],
    'Bug fixes': [],
    Other: [],
  };
  for (const r of rows) {
    const names = (namesOf.get(r.id) ?? []).map((n) => n.toLowerCase());
    const line = `- ${r.title} (${r.key}-${r.number})`;
    if (names.some((n) => n.includes('feature') || n.includes('enhancement')))
      sections.Features.push(line);
    else if (names.some((n) => n.includes('bug') || n.includes('fix')))
      sections['Bug fixes'].push(line);
    else sections.Other.push(line);
  }
  return Object.entries(sections)
    .filter(([, lines]) => lines.length > 0)
    .map(([heading, lines]) => [`## ${heading}`, '', ...lines, ''].join('\n'))
    .join('\n');
}

// Upserts the note covering this release and no other (Linear's `releaseNotes` input on
// syncs and completions).
export async function upsertOwnNote(
  tx: Tx,
  releaseRow: Pick<ReleaseRow, 'id' | 'pipelineId'>,
  note: { title?: unknown; content?: unknown },
): Promise<void> {
  if (typeof note.content !== 'string' || note.content.length > MAX_CONTENT) return;
  const title = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : null;
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
    return;
  }
  const [created] = await tx
    .insert(releaseNote)
    .values({ slugId: freeSlug(), pipelineId: releaseRow.pipelineId, title, content: note.content })
    .returning({ id: releaseNote.id });
  await tx.insert(releaseNoteRelease).values({ noteId: created!.id, releaseId: releaseRow.id });
}

// When the pipeline asks for it, gives a completed release without a note the "Fill
// from issues" draft (only when it has a completed issue to list).
export async function autoDraftNote(
  tx: Tx,
  releaseRow: ReleaseRow,
  pipeline: PipelineRow,
): Promise<void> {
  if (!pipeline.autoGenerateReleaseNotesOnCompletion || !releaseRow.completedAt) return;
  const [existing] = await tx
    .select({ id: releaseNoteRelease.noteId })
    .from(releaseNoteRelease)
    .where(eq(releaseNoteRelease.releaseId, releaseRow.id))
    .limit(1);
  if (existing) return;
  const content = await draftNoteContent(releaseRow.id, null, tx);
  if (!content) return;
  const [created] = await tx
    .insert(releaseNote)
    .values({ slugId: freeSlug(), pipelineId: pipeline.id, title: null, content })
    .returning({ id: releaseNote.id });
  await tx.insert(releaseNoteRelease).values({ noteId: created!.id, releaseId: releaseRow.id });
}
