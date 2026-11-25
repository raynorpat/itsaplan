import { db, releasePipeline, releasePipelineTeam, releaseStage, team } from '@repo/db';
import { and, asc, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  archivePipeline,
  createPipeline,
  deletePipeline,
  firstTeamKey,
  getPipeline,
  listablePipelinesSql,
  mapPipeline,
  pipelineReleaseCount,
  pipelineTeamIds,
  pipelineUrl,
  unarchivePipeline,
  updatePipeline,
  type PipelineDto,
  type PipelineInput,
} from '../../releases/pipelines';
import {
  archiveStage,
  createStage,
  getStage,
  mapStage,
  pipelineStages,
  unarchiveStage,
  updateStage,
  visibleStagesSql,
  type StageDto,
  type StageInput,
} from '../../releases/stages';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { pipelineSortKeys, tieBreaks } from '../list-sorts';
import { paginateSorted } from '../sort';
import { compare, compareId, filterSql, type FieldHandlers } from '../filter';
import { gqlError } from '../errors';
import { guard, lastSyncId, onlySupported } from './mutations';
import { teamFilter, toTeam } from './team';

// Linear's ReleasePipeline and ReleaseStage (releases/pipelines.ts, stages.ts).

type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null; sort?: unknown };

const PIPELINE_CREATE_FIELDS = [
  'id',
  'name',
  'slugId',
  'type',
  'isProduction',
  'includePathPatterns',
  'rolloverIssuesOnCompletion',
  'autoGenerateReleaseNotesOnCompletion',
  'teamIds',
];
const PIPELINE_UPDATE_FIELDS = PIPELINE_CREATE_FIELDS.filter((f) => f !== 'id');
const STAGE_CREATE_FIELDS = ['id', 'pipelineId', 'name', 'color', 'type', 'position', 'frozen'];
const STAGE_UPDATE_FIELDS = ['name', 'color', 'position', 'frozen'];

// ReleasePipelineFilter: id, name, type, isProduction, teams (some), createdAt,
// updatedAt, and / or.
export function pipelineFilterSql(filter: unknown): SQL | undefined {
  const handlers: FieldHandlers = {
    id: (v, p) => compareId(releasePipeline.id, v, p),
    name: (v, p) => compare(releasePipeline.name, v, p),
    type: (v, p) => compare(releasePipeline.type, v, p),
    isProduction: (v, p) => compare(releasePipeline.isProduction, v, p),
    createdAt: (v, p) => compare(releasePipeline.createdAt, v, p),
    updatedAt: (v, p) => compare(releasePipeline.updatedAt, v, p),
    teams: (v, p) => {
      const { some, ...rest } = v as Record<string, unknown>;
      if (Object.keys(rest).length)
        throw gqlError('INVALID_INPUT', `Filter ${p}.${Object.keys(rest)[0]} is not supported`);
      return sql`EXISTS (SELECT 1 FROM ${releasePipelineTeam}
        JOIN ${team} ON ${team.id} = ${releasePipelineTeam.teamId}
        WHERE ${releasePipelineTeam.pipelineId} = ${releasePipeline.id}
          AND ${filterSql(some, teamFilter, `${p}.some`) ?? sql`true`})`;
    },
  };
  return filterSql(filter, handlers);
}

// ReleaseStageFilter: id, name, type, createdAt, updatedAt, and / or.
export function stageFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, {
    id: (v, p) => compareId(releaseStage.id, v, p),
    name: (v, p) => compare(releaseStage.name, v, p),
    type: (v, p) => compare(releaseStage.type, v, p),
    createdAt: (v, p) => compare(releaseStage.createdAt, v, p),
    updatedAt: (v, p) => compare(releaseStage.updatedAt, v, p),
  });
}

export function listPipelines(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const scope = and(
    listablePipelinesSql(ctx.user.id, !!args.includeArchived),
    where,
    pipelineFilterSql(args.filter),
  );
  const keys = pipelineSortKeys(args.sort);
  if (keys)
    return paginateSorted(
      args,
      keys,
      tieBreaks.pipeline,
      sql`${releasePipeline.id}`,
      scope,
      (w, order, limit, select) =>
        db
          .select({ ...getTableColumns(releasePipeline), sortValues: select })
          .from(releasePipeline)
          .where(w)
          .orderBy(...order)
          .limit(limit),
      (row) => mapPipeline(row),
    );
  return paginate(
    args,
    {
      id: releasePipeline.id,
      createdAt: releasePipeline.createdAt,
      updatedAt: releasePipeline.updatedAt,
    },
    scope,
    (w, order, limit) =>
      db
        .select()
        .from(releasePipeline)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    mapPipeline,
  );
}

function listStages(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: releaseStage.id, createdAt: releaseStage.createdAt, updatedAt: releaseStage.updatedAt },
    and(
      visibleStagesSql(ctx.user.id),
      where,
      args.includeArchived ? undefined : isNull(releaseStage.archivedAt),
      stageFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(releaseStage)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    mapStage,
  );
}

// A list shown whole, in its own order, as one connection page.
export function wholeConnection<T extends { id: string }>(nodes: T[]) {
  const edges = nodes.map((node) => ({ node, cursor: node.id }));
  return {
    nodes,
    edges,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

const pipelinePayload = (releasePipeline: PipelineDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  releasePipeline,
});
const pipelineArchivePayload = (entity: PipelineDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  entity,
});
const stagePayload = (releaseStage: StageDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  releaseStage,
});
const stageArchivePayload = (entity: StageDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  entity,
});

type IdArg = { id: string };

export const releasePipelineResolvers = {
  Query: {
    releasePipeline: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(() => getPipeline(ctx.user, id)),
    releasePipelines: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      guard(() => listPipelines(undefined, args, ctx)),
    releaseStage: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(() => getStage(ctx.user, id)),
    releaseStages: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      guard(() => listStages(undefined, args, ctx)),
  },
  Mutation: {
    releasePipelineCreate: (_: unknown, { input }: { input: PipelineInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported({ ...input }, PIPELINE_CREATE_FIELDS, 'input');
        return pipelinePayload(await createPipeline(ctx.user, { ...input }));
      }),
    releasePipelineUpdate: (
      _: unknown,
      { id, input }: { id: string; input: PipelineInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, PIPELINE_UPDATE_FIELDS, 'input');
        return pipelinePayload(await updatePipeline(ctx.user, id, { ...input }));
      }),
    releasePipelineArchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => pipelineArchivePayload(await archivePipeline(ctx.user, id))),
    releasePipelineDelete: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => pipelineArchivePayload(await deletePipeline(ctx.user, id))),
    releasePipelineUnarchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => pipelineArchivePayload(await unarchivePipeline(ctx.user, id))),
    releaseStageCreate: (_: unknown, { input }: { input: StageInput }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported({ ...input }, STAGE_CREATE_FIELDS, 'input');
        return stagePayload(await createStage(ctx.user, { ...input }));
      }),
    releaseStageUpdate: (
      _: unknown,
      { id, input }: { id: string; input: StageInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported({ ...input }, STAGE_UPDATE_FIELDS, 'input');
        return stagePayload(await updateStage(ctx.user, id, { ...input }));
      }),
    releaseStageArchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => stageArchivePayload(await archiveStage(ctx.user, id))),
    releaseStageUnarchive: (_: unknown, { id }: IdArg, ctx: GraphQLContext) =>
      guard(async () => stageArchivePayload(await unarchiveStage(ctx.user, id))),
  },
  ReleasePipeline: {
    url: async (p: PipelineDto) => pipelineUrl(await firstTeamKey(p.id), p.slugId),
    teams: async (p: PipelineDto, _: unknown, ctx: GraphQLContext) => {
      const ids = await pipelineTeamIds(p.id, ctx.user.id);
      const rows = ids.length
        ? await db.select().from(team).where(inArray(team.id, ids)).orderBy(asc(team.key))
        : [];
      return wholeConnection(rows.map(toTeam));
    },
    stages: async (p: PipelineDto) => wholeConnection(await pipelineStages(p.id)),
    approximateReleaseCount: (p: PipelineDto) => pipelineReleaseCount(p.id),
    releaseNoteTemplate: () => null,
  },
  ReleaseStage: {
    pipeline: async (s: StageDto) => {
      const [row] = await db
        .select()
        .from(releasePipeline)
        .where(eq(releasePipeline.id, s.pipelineId));
      return mapPipeline(row!);
    },
  },
  Team: {
    releasePipelines: (t: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      guard(() =>
        listPipelines(
          sql`EXISTS (SELECT 1 FROM ${releasePipelineTeam}
            WHERE ${releasePipelineTeam.pipelineId} = ${releasePipeline.id}
              AND ${releasePipelineTeam.teamId} = ${t.id})`,
          args,
          ctx,
        ),
      ),
  },
};
