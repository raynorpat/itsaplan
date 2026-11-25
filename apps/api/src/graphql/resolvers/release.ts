import {
  db,
  issueToRelease,
  release,
  releaseDocument,
  releaseLink,
  releaseNoteRelease,
  releasePipeline,
  releaseStage,
} from '@repo/db';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { iso } from '../../shared/lib';
import {
  addIssueToRelease,
  getIssueToRelease,
  inReleaseSql,
  mapIssueToRelease,
  releaseIssueCount,
  removeIssueFromRelease,
  removeIssueToRelease,
  visibleLinksSql,
  type IssueToReleaseDto,
} from '../../releases/issues';
import { mapPipeline, pipelineUrl, type PipelineDto } from '../../releases/pipelines';
import { releaseProgress } from '../../releases/progress';
import { mapStage, type StageDto } from '../../releases/stages';
import {
  archiveRelease,
  completeReleaseByPipeline,
  createRelease,
  deleteRelease,
  getRelease,
  listableReleasesSql,
  mapRelease,
  releaseUrl,
  searchOrder,
  searchTermSql,
  unarchiveRelease,
  updateRelease,
  updateReleaseByPipeline,
  type ByPipelineInput,
  type CompleteInput,
  type ReleaseDto,
  type ReleaseInput,
} from '../../releases/store';
import type { GraphQLContext } from '../context';
import { loaders } from '../loaders';
import { paginate, type PageArgs } from '../connection';
import { releaseSortKeys, tieBreaks } from '../list-sorts';
import { paginateSorted } from '../sort';
import { compare, compareId, filterSql } from '../filter';
import { gqlError } from '../errors';
import { issueById, listIssues, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { pipelineFilterSql, stageFilterSql, wholeConnection } from './release-pipeline';

// Linear's Release and IssueToRelease (releases/store.ts, issues.ts, progress.ts).

type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null; sort?: unknown };
type IssueArgs = ListArgs & { sort?: null };

const CREATE_FIELDS = [
  'id',
  'pipelineId',
  'stageId',
  'name',
  'version',
  'description',
  'commitSha',
  'startDate',
  'targetDate',
  'startedAt',
  'completedAt',
  'createdAt',
];
const UPDATE_FIELDS = [
  'stageId',
  'name',
  'version',
  'description',
  'commitSha',
  'startDate',
  'targetDate',
  'startedAt',
  'completedAt',
  'trashed',
];
const CONTENT_FIELDS = ['links', 'documents', 'releaseNotes', 'name', 'description', 'version'];
const BY_PIPELINE_FIELDS = ['pipelineId', 'stage', ...CONTENT_FIELDS];
const COMPLETE_FIELDS = ['pipelineId', 'commitSha', ...CONTENT_FIELDS];

// ReleaseFilter: id, name, version, completedAt, createdAt, updatedAt,
// hasReleaseNotes, pipeline, stage, and / or.
export function releaseFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, {
    id: (v, p) => compareId(release.id, v, p),
    name: (v, p) => compare(release.name, v, p),
    version: (v, p) => compare(release.version, v, p),
    completedAt: (v, p) => compare(release.completedAt, v, p),
    createdAt: (v, p) => compare(release.createdAt, v, p),
    updatedAt: (v, p) => compare(release.updatedAt, v, p),
    hasReleaseNotes: (v, p) => {
      const hasNotes = sql`EXISTS (SELECT 1 FROM ${releaseNoteRelease}
        WHERE ${releaseNoteRelease.releaseId} = ${release.id})`;
      const { eq: is, neq, ...rest } = (v ?? {}) as { eq?: boolean; neq?: boolean };
      if (Object.keys(rest).length || (is === undefined && neq === undefined))
        throw gqlError('INVALID_INPUT', `Filter ${p} takes eq or neq`);
      const want = is ?? !neq;
      return want ? hasNotes : sql`NOT ${hasNotes}`;
    },
    pipeline: (v) =>
      sql`${release.pipelineId} IN (SELECT ${releasePipeline.id} FROM ${releasePipeline}
        WHERE ${pipelineFilterSql(v) ?? sql`true`})`,
    stage: (v) =>
      sql`${release.stageId} IN (SELECT ${releaseStage.id} FROM ${releaseStage}
        WHERE ${stageFilterSql(v) ?? sql`true`})`,
  });
}

function listReleases(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const scope = and(
    listableReleasesSql(ctx.user.id, !!args.includeArchived),
    where,
    releaseFilterSql(args.filter),
  );
  const keys = releaseSortKeys(args.sort);
  if (keys)
    return paginateSorted(
      args,
      keys,
      tieBreaks.release,
      sql`${release.id}`,
      scope,
      (w, values) => db.select(values).from(release).where(w),
      (ids) => db.select().from(release).where(inArray(release.id, ids)),
      (row) => mapRelease(row),
    );
  return paginate(
    args,
    { id: release.id, createdAt: release.createdAt, updatedAt: release.updatedAt },
    scope,
    (w, order, limit) =>
      db
        .select()
        .from(release)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    mapRelease,
  );
}

const releasePayload = (r: ReleaseDto) => ({ success: true, lastSyncId: lastSyncId(), release: r });
const archivePayload = (entity: ReleaseDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  entity,
});
const deletePayload = (entityId: string) => ({ success: true, lastSyncId: lastSyncId(), entityId });

type IdArg = { id: string };

export const releaseResolvers = {
  Query: {
    release: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(() => getRelease(ctx.user, id)),
    releases: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      guard(() => listReleases(undefined, args, ctx)),
    releaseSearch: (
      _: unknown,
      args: { term?: string | null; filter?: unknown; first?: number | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const first = Math.min(Math.max(args.first ?? 20, 1), 250);
        const rows = await db
          .select({ r: release })
          .from(release)
          .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
          .innerJoin(releasePipeline, eq(releasePipeline.id, release.pipelineId))
          .where(
            and(
              listableReleasesSql(ctx.user.id, false),
              searchTermSql(args.term),
              releaseFilterSql(args.filter),
            ),
          )
          .orderBy(...searchOrder())
          .limit(first);
        return rows.map((row) => mapRelease(row.r));
      }),
    issueToRelease: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(() => getIssueToRelease(ctx.user, id)),
    issueToReleases: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      guard(() =>
        paginate<Parameters<typeof mapIssueToRelease>[0] & { updatedAt: Date }, IssueToReleaseDto>(
          args,
          {
            id: issueToRelease.id,
            createdAt: issueToRelease.createdAt,
            updatedAt: issueToRelease.createdAt,
          },
          visibleLinksSql(ctx.user.id),
          (w, order, limit) =>
            db
              .select({
                id: issueToRelease.id,
                issueId: issueToRelease.issueId,
                releaseId: issueToRelease.releaseId,
                commitSha: issueToRelease.commitSha,
                createdAt: issueToRelease.createdAt,
                updatedAt: issueToRelease.createdAt,
              })
              .from(issueToRelease)
              .where(w)
              .orderBy(...order)
              .limit(limit),
          mapIssueToRelease,
        ),
      ),
  },
  Mutation: {
    releaseCreate: (_: unknown, { input }: { input: ReleaseInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported({ ...input }, CREATE_FIELDS, 'input');
        return releasePayload(await createRelease(ctx.user, { ...input }));
      }),
    releaseUpdate: (
      _: unknown,
      { id, input }: { id: string; input: ReleaseInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, UPDATE_FIELDS, 'input');
        return releasePayload(await updateRelease(ctx.user, id, { ...input }));
      }),
    releaseUpdateByPipeline: (
      _: unknown,
      { input }: { input: ByPipelineInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, BY_PIPELINE_FIELDS, 'input');
        return releasePayload(await updateReleaseByPipeline(ctx.user, plain(input)));
      }),
    releaseComplete: (_: unknown, { input }: { input: CompleteInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported({ ...input }, COMPLETE_FIELDS, 'input');
        return releasePayload(await completeReleaseByPipeline(ctx.user, plain(input)));
      }),
    releaseArchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => archivePayload(await archiveRelease(ctx.user, id))),
    releaseDelete: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => archivePayload(await deleteRelease(ctx.user, id))),
    releaseUnarchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => archivePayload(await unarchiveRelease(ctx.user, id))),
    issueToReleaseCreate: (
      _: unknown,
      { input }: { input: { id?: string; issueId: string; releaseId: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, ['id', 'issueId', 'releaseId'], 'input');
        return {
          success: true,
          lastSyncId: lastSyncId(),
          issueToRelease: await addIssueToRelease(ctx.user, { ...input }),
        };
      }),
    issueToReleaseDelete: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => deletePayload(await removeIssueToRelease(ctx.user, id))),
    issueToReleaseDeleteByIssueAndRelease: (
      _: unknown,
      args: { issueId: string; releaseId: string },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        deletePayload(await removeIssueFromRelease(ctx.user, args.issueId, args.releaseId)),
      ),
  },
  Release: {
    url: async (r: ReleaseDto, _: unknown, ctx: GraphQLContext) => {
      const l = loaders(ctx);
      const [pipeline, teamKey] = await Promise.all([
        l.releasePipeline.load(r.pipelineId),
        l.pipelineTeamKey.load(r.pipelineId),
      ]);
      return `${pipelineUrl(teamKey, pipeline?.slugId ?? '')}/${r.slugId}`;
    },
    autoArchivedAt: () => null,
    pipeline: async (r: ReleaseDto, _: unknown, ctx: GraphQLContext): Promise<PipelineDto> =>
      mapPipeline((await loaders(ctx).releasePipeline.load(r.pipelineId))!),
    stage: async (r: ReleaseDto, _: unknown, ctx: GraphQLContext): Promise<StageDto> =>
      mapStage((await loaders(ctx).releaseStage.load(r.stageId))!),
    creator: (r: ReleaseDto, _: unknown, ctx: GraphQLContext) => userById(r.creatorId, ctx.user.id),
    issues: (r: ReleaseDto, args: IssueArgs, ctx: GraphQLContext) =>
      guard(() => listIssues(inReleaseSql(r.id), args, ctx.user.id)),
    issueCount: (r: ReleaseDto, args: { includeArchived?: boolean | null }, ctx: GraphQLContext) =>
      args.includeArchived
        ? releaseIssueCount(r.id, ctx.user.id, true)
        : loaders(ctx).releaseIssueCount.load(r.id),
    currentProgress: (r: ReleaseDto, _: unknown, ctx: GraphQLContext) =>
      releaseProgress(r.id, ctx.user.id),
    // Progress snapshots over time are not kept for releases.
    progressHistory: () => ({}),
    history: () => wholeConnection([]),
    links: async (r: ReleaseDto) => {
      const rows = await db
        .select()
        .from(releaseLink)
        .where(eq(releaseLink.releaseId, r.id))
        .orderBy(asc(releaseLink.createdAt), asc(releaseLink.url));
      return wholeConnection(
        rows.map((l, i) => ({
          id: l.id,
          url: l.url,
          label: l.label ?? l.url,
          sortOrder: (i + 1) * 1000,
          createdAt: iso(l.createdAt),
          updatedAt: iso(l.createdAt),
          archivedAt: null,
          creator: null,
        })),
      );
    },
    documents: async (r: ReleaseDto) => {
      const rows = await db
        .select()
        .from(releaseDocument)
        .where(eq(releaseDocument.releaseId, r.id))
        .orderBy(asc(releaseDocument.createdAt), asc(releaseDocument.title));
      const url = await releaseUrl(r);
      return wholeConnection(
        rows.map((d, i) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          icon: null,
          color: null,
          sortOrder: (i + 1) * 1000,
          slugId: d.id.slice(0, 12),
          projectId: null,
          issueId: null,
          creatorUserId: null,
          updatedByUserId: null,
          ownerUserId: null,
          hiddenAt: null,
          archivedAt: null,
          trashed: null,
          createdAt: iso(d.createdAt),
          updatedAt: iso(d.updatedAt),
          documentContentId: d.id,
          releaseId: r.id,
          releaseUrl: url,
        })),
      );
    },
  },
  IssueToRelease: {
    issue: (l: IssueToReleaseDto) => issueById(l.issueId),
    release: async (l: IssueToReleaseDto) => {
      const [row] = await db.select().from(release).where(eq(release.id, l.releaseId));
      return mapRelease(row!);
    },
  },
  Document: {
    release: async (d: { releaseId?: string }) => {
      if (!d.releaseId) return null;
      const [row] = await db.select().from(release).where(eq(release.id, d.releaseId));
      return row ? mapRelease(row) : null;
    },
  },
  Issue: {
    releases: (i: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      guard(() =>
        listReleases(
          inArray(
            release.id,
            db
              .select({ id: issueToRelease.releaseId })
              .from(issueToRelease)
              .where(eq(issueToRelease.issueId, i.id)),
          ),
          args,
          ctx,
        ),
      ),
  },
  ReleasePipeline: {
    releases: (p: PipelineDto, args: ListArgs, ctx: GraphQLContext) =>
      guard(() => listReleases(eq(release.pipelineId, p.id), args, ctx)),
  },
  ReleaseStage: {
    releases: (s: StageDto, args: ListArgs, ctx: GraphQLContext) =>
      guard(() => listReleases(eq(release.stageId, s.id), args, ctx)),
  },
};

// GraphQL input objects have no prototype; the store reads plain copies.
const plain = <T>(input: T): T => JSON.parse(JSON.stringify(input)) as T;
