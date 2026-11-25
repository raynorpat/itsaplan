import {
  db,
  issue,
  issueToRelease,
  release,
  releasePipeline,
  releasePipelineTeam,
  releaseStage,
  team,
} from '@repo/db';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import {
  applyReleaseContent,
  cleanName,
  cleanText,
  freeReleaseSlug,
  lockPipeline,
  releaseForPipeline,
  rethrowVersion,
  stageOfType,
  stagesOf,
  type ReleaseContent,
  type ReleaseRow,
  type Tx,
} from './store';
import { autoDraftNote } from './notes';

// Linear's releaseSync (and releaseSyncByAccessKey): what a CI job sends for a deploy.
//
// - Continuous pipeline: the release with `version` (default: the first 7 characters of
//   the commit SHA), created completed when new; a version already used by another
//   commit is refused.
// - Scheduled pipeline: the release with `version` (created in the first started stage
//   when new), else the latest started release, else the earliest planned one, else a
//   new planned "Next". A release in a frozen stage takes no new issues: the sync goes
//   to the next open release that is not frozen (a new planned "Next" when none).
//
// Issue references name issues by identifier (any case); issues of teams outside the
// pipeline, archived issues and unknown identifiers are skipped. Links, documents and
// release notes are upserted; pull request references are skipped (no code-host
// integration here). One sync of a pipeline runs at a time (an advisory lock), so a
// repeated sync finds the release the first one made.

type PipelineRow = typeof releasePipeline.$inferSelect;
type StageRow = typeof releaseStage.$inferSelect;

interface IssueReference {
  identifier?: unknown;
  commitSha?: unknown;
}

export interface SyncInput extends ReleaseContent {
  commitSha?: unknown;
  version?: unknown;
  name?: unknown;
  description?: unknown;
  issueReferences?: IssueReference[] | null;
  revertedIssueReferences?: IssueReference[] | null;
  repository?: unknown;
  preserveStoredCommitSha?: boolean | null;
}

export type SkipReason = 'notFound' | 'archived' | 'otherTeam';

export interface SyncResult {
  release: ReleaseRow;
  added: string[];
  skipped: { identifier: string; reason: SkipReason }[];
  // The version (else name) of the release in a frozen stage the sync aimed at, when it
  // went to the next open release instead.
  redirectedFrom: string | null;
}

const MAX_REFERENCES = 1000;
const IDENTIFIER = /^([A-Za-z0-9]+)-(\d{1,9})$/;

function references(value: IssueReference[] | null | undefined, what: string) {
  const list = value ?? [];
  if (list.length > MAX_REFERENCES)
    throw new HttpError(400, `${what} has at most ${MAX_REFERENCES} entries`);
  return list.flatMap((r) =>
    typeof r.identifier === 'string' && r.identifier.trim()
      ? [
          {
            identifier: r.identifier.trim(),
            commitSha: typeof r.commitSha === 'string' ? r.commitSha : null,
          },
        ]
      : [],
  );
}

// A copy of Linear's RepositoryDataInput as a plain object (GraphQL inputs have no
// prototype).
function repositoryOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

// The release with this version. An archived or trashed one keeps its version (the
// unique index covers it), so a sync naming it is refused until it is restored.
async function byVersion(tx: Tx, pipelineId: string, version: string) {
  const [row] = await tx
    .select()
    .from(release)
    .where(and(eq(release.pipelineId, pipelineId), eq(release.version, version)));
  if (row && (row.archivedAt || row.trashed))
    throw new HttpError(400, `Release ${version} is archived or deleted; restore it first`);
  return row ?? null;
}

async function insertRelease(
  tx: Tx,
  pipeline: PipelineRow,
  stage: StageRow,
  values: { name: string; version: string | null; creatorId: string | null },
): Promise<ReleaseRow> {
  // The database's clock: shipped updates (shipped.ts) compare these times with times
  // the database stamps (issue_to_release.created_at).
  const now = sql`now()`;
  const started = stage.type === 'started' || stage.type === 'completed';
  try {
    const [row] = await tx
      .insert(release)
      .values({
        slugId: await freeReleaseSlug(values.name, tx),
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: values.name,
        version: values.version,
        creatorId: values.creatorId,
        startedAt: started ? now : null,
        completedAt: stage.type === 'completed' ? now : null,
      })
      .returning();
    return row!;
  } catch (err) {
    rethrowVersion(err);
  }
}

const isFrozen = (stages: StageRow[], row: ReleaseRow) =>
  stages.find((s) => s.id === row.stageId)?.frozen ?? false;

// The next open release that is not in a frozen stage: the latest started, else the
// planned one with the earliest target date, else a new planned "Next".
async function nextOpenRelease(
  tx: Tx,
  pipeline: PipelineRow,
  stages: StageRow[],
  excludeId: string,
  creatorId: string | null,
): Promise<ReleaseRow> {
  const open = stages.filter((s) => !s.frozen && (s.type === 'started' || s.type === 'planned'));
  if (open.length > 0) {
    const [found] = await tx
      .select({ r: release })
      .from(release)
      .innerJoin(releaseStage, eq(releaseStage.id, release.stageId))
      .where(
        and(
          eq(release.pipelineId, pipeline.id),
          ne(release.id, excludeId),
          isNull(release.archivedAt),
          eq(release.trashed, false),
          inArray(
            release.stageId,
            open.map((s) => s.id),
          ),
        ),
      )
      .orderBy(
        sql`CASE ${releaseStage.type} WHEN 'started' THEN 0 ELSE 1 END`,
        desc(release.startedAt),
        sql`${release.targetDate} ASC NULLS LAST`,
        asc(release.createdAt),
      )
      .limit(1);
    if (found) return found.r;
  }
  const planned = await stageOfType(pipeline.id, 'planned', tx);
  return insertRelease(tx, pipeline, planned, { name: 'Next', version: null, creatorId });
}

async function continuousTarget(
  tx: Tx,
  pipeline: PipelineRow,
  sha: string,
  version: string | null,
  name: string | null,
  creatorId: string | null,
): Promise<ReleaseRow> {
  const wanted = version ?? sha.slice(0, 7);
  const existing = await byVersion(tx, pipeline.id, wanted);
  if (existing) {
    if (existing.commitSha && existing.commitSha !== sha)
      throw new HttpError(400, `Version ${wanted} is already used by another commit`);
    return existing;
  }
  const completed = await stageOfType(pipeline.id, 'completed', tx);
  return insertRelease(tx, pipeline, completed, {
    name: name ?? wanted,
    version: wanted,
    creatorId,
  });
}

async function scheduledTarget(
  tx: Tx,
  pipeline: PipelineRow,
  version: string | null,
  name: string | null,
  creatorId: string | null,
): Promise<{ row: ReleaseRow; redirectedFrom: string | null }> {
  const stages = await stagesOf(pipeline.id, tx);
  let row: ReleaseRow | null = version
    ? await byVersion(tx, pipeline.id, version)
    : await releaseForPipeline(pipeline.id, null, { planned: true }, tx);
  if (!row && version) {
    const started = await stageOfType(pipeline.id, 'started', tx);
    row = await insertRelease(tx, pipeline, started, { name: name ?? version, version, creatorId });
  }
  if (!row) {
    const planned = await stageOfType(pipeline.id, 'planned', tx);
    row = await insertRelease(tx, pipeline, planned, {
      name: name ?? 'Next',
      version: null,
      creatorId,
    });
  }
  if (!isFrozen(stages, row)) return { row, redirectedFrom: null };
  const next = await nextOpenRelease(tx, pipeline, stages, row.id, creatorId);
  return { row: next, redirectedFrom: row.version ?? row.name };
}

// The issues the references name, by lowercased identifier.
async function referencedIssues(
  tx: Tx,
  identifiers: string[],
): Promise<Map<string, { id: string; teamId: string; archived: boolean }>> {
  const found = new Map<string, { id: string; teamId: string; archived: boolean }>();
  const wanted = identifiers.flatMap((identifier) => {
    const m = IDENTIFIER.exec(identifier);
    return m ? [{ key: m[1]!.toUpperCase(), number: Number(m[2]) }] : [];
  });
  if (wanted.length === 0) return found;
  const rows = await tx
    .select({
      id: issue.id,
      teamId: issue.teamId,
      archivedAt: issue.archivedAt,
      key: team.key,
      number: issue.sequenceNumber,
    })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(
      and(
        inArray(
          team.key,
          wanted.map((w) => w.key),
        ),
        inArray(
          issue.sequenceNumber,
          wanted.map((w) => w.number),
        ),
      ),
    );
  for (const r of rows)
    found.set(`${r.key}-${r.number}`.toLowerCase(), {
      id: r.id,
      teamId: r.teamId,
      archived: r.archivedAt !== null,
    });
  return found;
}

async function pipelineTeams(tx: Tx, pipelineId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ teamId: releasePipelineTeam.teamId })
    .from(releasePipelineTeam)
    .where(eq(releasePipelineTeam.pipelineId, pipelineId));
  return new Set(rows.map((r) => r.teamId));
}

function skipReason(
  found: { teamId: string; archived: boolean } | undefined,
  teams: Set<string>,
): SkipReason | null {
  if (!found) return 'notFound';
  if (!teams.has(found.teamId)) return 'otherTeam';
  if (found.archived) return 'archived';
  return null;
}

export async function syncRelease(
  pipeline: PipelineRow,
  input: SyncInput,
  creatorId: string | null,
): Promise<SyncResult> {
  if (pipeline.archivedAt || pipeline.trashed)
    throw new HttpError(400, 'The release pipeline is archived');
  const sha = cleanText(input.commitSha, 'commitSha', 64);
  if (!sha) throw new HttpError(400, 'commitSha is required');
  const version = cleanText(input.version, 'version', 255);
  const name = input.name === undefined || input.name === null ? null : cleanName(input.name);
  const description = cleanText(input.description, 'description', 100_000);
  const added = references(input.issueReferences, 'issueReferences');
  const reverted = references(input.revertedIssueReferences, 'revertedIssueReferences');
  const repository = repositoryOf(input.repository);

  return db.transaction(async (tx) => {
    await lockPipeline(tx, pipeline.id);
    let target: ReleaseRow;
    let redirectedFrom: string | null = null;
    if (pipeline.type === 'continuous') {
      target = await continuousTarget(tx, pipeline, sha, version, name, creatorId);
    } else {
      ({ row: target, redirectedFrom } = await scheduledTarget(
        tx,
        pipeline,
        version,
        name,
        creatorId,
      ));
    }

    const set: Partial<typeof release.$inferInsert> = {};
    if (name !== null) set.name = name;
    if (input.description !== undefined) set.description = description;
    if (repository) set.repository = repository;
    const keepSha =
      pipeline.type === 'scheduled' && input.preserveStoredCommitSha && target.commitSha;
    if (!keepSha) set.commitSha = sha;
    const [updated] = await tx
      .update(release)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(release.id, target.id))
      .returning();
    target = updated!;

    const teams = await pipelineTeams(tx, pipeline.id);
    const issues = await referencedIssues(tx, [
      ...added.map((r) => r.identifier),
      ...reverted.map((r) => r.identifier),
    ]);
    const result: SyncResult = { release: target, added: [], skipped: [], redirectedFrom };
    for (const ref of added) {
      const found = issues.get(ref.identifier.toLowerCase());
      const reason = skipReason(found, teams);
      if (!found || reason) {
        result.skipped.push({ identifier: ref.identifier, reason: reason ?? 'notFound' });
        continue;
      }
      const inserted = await tx
        .insert(issueToRelease)
        .values({ issueId: found.id, releaseId: target.id, commitSha: ref.commitSha })
        .onConflictDoNothing()
        .returning({ id: issueToRelease.id });
      if (inserted.length > 0) result.added.push(ref.identifier.toUpperCase());
    }
    if (pipeline.type === 'scheduled' && reverted.length > 0) {
      const ids = reverted.flatMap((r) => {
        const found = issues.get(r.identifier.toLowerCase());
        return found ? [found.id] : [];
      });
      if (ids.length > 0)
        await tx
          .delete(issueToRelease)
          .where(
            and(eq(issueToRelease.releaseId, target.id), inArray(issueToRelease.issueId, ids)),
          );
    }
    await applyReleaseContent(tx, target, input);
    await autoDraftNote(tx, target, pipeline);
    return result;
  });
}
