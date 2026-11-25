import { db, release, releaseNote, releaseNoteRelease, releasePipeline } from '@repo/db';
import { and, sql, type SQL } from 'drizzle-orm';
import {
  createNote,
  deleteNote,
  getNote,
  latestNoteOfPipeline,
  mapNote,
  notesOfRelease,
  releasesOfNote,
  updateNote,
  visibleNotesSql,
  type NoteInput,
  type ReleaseNoteDto,
} from '../../releases/notes';
import { firstTeamKey, mapPipeline, pipelineUrl, type PipelineDto } from '../../releases/pipelines';
import { mapRelease, releaseUrl, type ReleaseDto } from '../../releases/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { compare, compareId, filterSql } from '../filter';
import { guard, lastSyncId, onlySupported } from './mutations';
import { pipelineFilterSql } from './release-pipeline';
import { releaseFilterSql } from './release';

// Linear's ReleaseNote (releases/notes.ts), Release.releaseNotes and
// ReleasePipeline.latestReleaseNote.

type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

const CREATE_FIELDS = [
  'id',
  'pipelineId',
  'releaseIds',
  'rangeFromReleaseId',
  'rangeToReleaseId',
  'title',
  'content',
];
const UPDATE_FIELDS = ['releaseIds', 'rangeFromReleaseId', 'rangeToReleaseId', 'title', 'content'];

// ReleaseNoteFilter: id, slugId, title, createdAt, updatedAt, pipeline, release, and / or.
function noteFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, {
    id: (v, p) => compareId(releaseNote.id, v, p),
    slugId: (v, p) => compare(releaseNote.slugId, v, p),
    title: (v, p) => compare(releaseNote.title, v, p),
    createdAt: (v, p) => compare(releaseNote.createdAt, v, p),
    updatedAt: (v, p) => compare(releaseNote.updatedAt, v, p),
    pipeline: (v) =>
      sql`${releaseNote.pipelineId} IN (SELECT ${releasePipeline.id} FROM ${releasePipeline}
        WHERE ${pipelineFilterSql(v) ?? sql`true`})`,
    release: (v) =>
      sql`EXISTS (SELECT 1 FROM ${releaseNoteRelease}
        JOIN ${release} ON ${release.id} = ${releaseNoteRelease.releaseId}
        WHERE ${releaseNoteRelease.noteId} = ${releaseNote.id}
          AND ${releaseFilterSql(v) ?? sql`true`})`,
  });
}

const notePayload = (n: ReleaseNoteDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  releaseNote: n,
});

// GraphQL input objects have no prototype; the store reads plain copies.
const plain = <T>(input: T): T => JSON.parse(JSON.stringify(input)) as T;

export const releaseNoteResolvers = {
  Query: {
    releaseNote: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(() => getNote(ctx.user, id)),
    releaseNotes: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      guard(() =>
        paginate(
          args,
          {
            id: releaseNote.id,
            createdAt: releaseNote.createdAt,
            updatedAt: releaseNote.updatedAt,
          },
          and(visibleNotesSql(ctx.user.id), noteFilterSql(args.filter)),
          (w, order, limit) =>
            db
              .select()
              .from(releaseNote)
              .where(w)
              .orderBy(...order)
              .limit(limit),
          mapNote,
        ),
      ),
  },
  Mutation: {
    releaseNoteCreate: (_: unknown, { input }: { input: NoteInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported({ ...input }, CREATE_FIELDS, 'input');
        return notePayload(await createNote(ctx.user, plain(input)));
      }),
    releaseNoteUpdate: (
      _: unknown,
      { id, input }: { id: string; input: NoteInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, UPDATE_FIELDS, 'input');
        return notePayload(await updateNote(ctx.user, id, plain(input)));
      }),
    releaseNoteDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => ({
        success: true,
        lastSyncId: lastSyncId(),
        entityId: await deleteNote(ctx.user, id),
      })),
  },
  ReleaseNote: {
    // The body; null while nothing has been written.
    documentContent: (n: ReleaseNoteDto) =>
      n.content
        ? {
            id: n.id,
            content: n.content,
            contentState: null,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            archivedAt: null,
            restoredAt: null,
          }
        : null,
    generationStatus: () => null,
    pipeline: async (n: ReleaseNoteDto): Promise<PipelineDto> => {
      const [row] = await db
        .select()
        .from(releasePipeline)
        .where(sql`${releasePipeline.id} = ${n.pipelineId}`);
      return mapPipeline(row!);
    },
    releases: async (n: ReleaseNoteDto): Promise<ReleaseDto[]> =>
      (await releasesOfNote(n.id)).map(mapRelease),
    releaseCount: async (n: ReleaseNoteDto) => (await releasesOfNote(n.id)).length,
    firstRelease: async (n: ReleaseNoteDto) => {
      const rows = await releasesOfNote(n.id);
      return rows.length ? mapRelease(rows[0]!) : null;
    },
    lastRelease: async (n: ReleaseNoteDto) => {
      const rows = await releasesOfNote(n.id);
      return rows.length ? mapRelease(rows[rows.length - 1]!) : null;
    },
    // A note is shown on the page of the last release it covers.
    url: async (n: ReleaseNoteDto) => {
      const rows = await releasesOfNote(n.id);
      const last = rows[rows.length - 1];
      if (last) return releaseUrl({ pipelineId: last.pipelineId, slugId: last.slugId });
      const [p] = await db
        .select({ slugId: releasePipeline.slugId })
        .from(releasePipeline)
        .where(sql`${releasePipeline.id} = ${n.pipelineId}`);
      return pipelineUrl(await firstTeamKey(n.pipelineId), p?.slugId ?? '');
    },
  },
  Release: {
    releaseNotes: (r: ReleaseDto) => notesOfRelease(r.id),
  },
  ReleasePipeline: {
    latestReleaseNote: (p: PipelineDto) => latestNoteOfPipeline(p.id),
  },
};
