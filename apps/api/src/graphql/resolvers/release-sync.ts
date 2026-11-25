import { db, release, releaseStage } from '@repo/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireUser } from '../../shared/access';
import { HttpError, iso, UUID_RE } from '../../shared/lib';
import { assertPipelineWrite } from '../../releases/access';
import { accessKeyPipeline } from '../../releases/keys';
import {
  completeByPipeline,
  mapRelease,
  releaseUrl,
  updateByPipeline,
  type ByPipelineInput,
  type CompleteInput,
  type ReleaseRow,
} from '../../releases/store';
import { syncRelease, type SyncInput, type SyncResult } from '../../releases/sync';

// What a sync added and skipped, sent in the response's `extensions.releaseSync`
// (Linear's payload has no field for it), so a CI log shows a mistyped identifier.
const syncReport = (r: SyncResult) => ({
  added: r.added,
  skipped: r.skipped,
  redirectedFrom: r.redirectedFrom,
});
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { guard, lastSyncId } from './mutations';

// Linear's release sync for CI: releaseSync for people, and the *ByAccessKey
// operations, which only a release pipeline access key reaches (graphql/mount.ts) and
// which act on that key's pipeline.

const plain = <T>(input: T): T => JSON.parse(JSON.stringify(input ?? {})) as T;

function requireAccessKey(ctx: GraphQLContext) {
  if (!ctx.accessKey)
    throw gqlError('AUTHENTICATION_ERROR', 'This operation needs a release pipeline access key');
  return ctx.accessKey;
}

// Linear's AccessKeyRelease: the release as a CI job sees it.
async function accessKeyRelease(row: ReleaseRow) {
  const [stage] = await db
    .select({ name: releaseStage.name, type: releaseStage.type })
    .from(releaseStage)
    .where(eq(releaseStage.id, row.stageId));
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    commitSha: row.commitSha,
    createdAt: iso(row.createdAt),
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    stage: stage ?? null,
    url: await releaseUrl(row),
  };
}

const keyPayload = async (row: ReleaseRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  release: await accessKeyRelease(row),
});

// The pipeline's releases, most recently completed or updated first, after the
// release `after` in that order.
async function recentReleases(
  pipelineId: string,
  args: { after?: string | null; includeArchived?: boolean | null; limit?: number | null },
): Promise<ReleaseRow[]> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const recency = sql`coalesce(${release.completedAt}, ${release.updatedAt})`;
  let after: ReleaseRow | undefined;
  if (args.after) {
    if (!UUID_RE.test(args.after)) throw new HttpError(400, 'after must be a release id');
    [after] = await db
      .select()
      .from(release)
      .where(and(eq(release.id, args.after), eq(release.pipelineId, pipelineId)));
    if (!after) throw new HttpError(400, 'after must be a release of the pipeline');
  }
  return db
    .select()
    .from(release)
    .where(
      and(
        eq(release.pipelineId, pipelineId),
        eq(release.trashed, false),
        args.includeArchived ? undefined : isNull(release.archivedAt),
        after
          ? sql`(${recency}, ${release.id}) < (${after.completedAt ?? after.updatedAt}, ${after.id})`
          : undefined,
      ),
    )
    .orderBy(desc(recency), desc(release.id))
    .limit(limit);
}

type InputArg<T> = { input: T };

export const releaseSyncResolvers = {
  Query: {
    releasePipelineByAccessKey: (_: unknown, __: unknown, ctx: GraphQLContext) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        return { id: pipeline.id, includePathPatterns: pipeline.includePathPatterns };
      }),
    latestReleaseByAccessKey: (_: unknown, __: unknown, ctx: GraphQLContext) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        const [latest] = await recentReleases(pipeline.id, { limit: 1 });
        return latest ? accessKeyRelease(latest) : null;
      }),
    recentReleasesByAccessKey: (
      _: unknown,
      args: { after?: string | null; includeArchived?: boolean | null; limit?: number | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        const rows = await recentReleases(pipeline.id, args);
        return Promise.all(rows.map(accessKeyRelease));
      }),
  },
  Mutation: {
    releaseSync: (
      _: unknown,
      { input }: InputArg<SyncInput & { pipelineId?: string }>,
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const user = requireUser(ctx.user);
        const { pipelineId, ...rest } = plain(input);
        if (typeof pipelineId !== 'string') throw new HttpError(400, 'pipelineId is required');
        const pipeline = await assertPipelineWrite(user, pipelineId);
        const result = await syncRelease(pipeline, rest, user.id);
        ctx.extensions.releaseSync = syncReport(result);
        return { success: true, lastSyncId: lastSyncId(), release: mapRelease(result.release) };
      }),
    releaseSyncByAccessKey: (_: unknown, { input }: InputArg<SyncInput>, ctx: GraphQLContext) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        const result = await syncRelease(pipeline, plain(input), null);
        ctx.extensions.releaseSync = syncReport(result);
        return keyPayload(result.release);
      }),
    releaseUpdateByPipelineByAccessKey: (
      _: unknown,
      { input }: InputArg<ByPipelineInput>,
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        return keyPayload(await updateByPipeline(pipeline, plain(input)));
      }),
    releaseCompleteByAccessKey: (
      _: unknown,
      { input }: InputArg<CompleteInput>,
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const pipeline = await accessKeyPipeline(requireAccessKey(ctx));
        return keyPayload(await completeByPipeline(pipeline, plain(input)));
      }),
  },
};
