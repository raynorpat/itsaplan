import { db, issue, issueToRelease, release, releasePipelineTeam, team } from '@repo/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { visibleTeamIds, type AuthUser } from '../shared/access';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import { assertPipelineWrite } from './access';
import { assertReleaseRead, visibleReleasesSql } from './store';

// Issues in releases (Linear's IssueToRelease). An issue joins a release only when its
// team is one of the release's pipeline teams; an issue is in a release once. A link is
// visible when both its issue and its release are.

export interface IssueToReleaseDto {
  id: string;
  issueId: string;
  releaseId: string;
  commitSha: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: null;
}

type Row = Pick<
  typeof issueToRelease.$inferSelect,
  'id' | 'issueId' | 'releaseId' | 'commitSha' | 'createdAt'
>;

export const mapIssueToRelease = (row: Row): IssueToReleaseDto => ({
  id: row.id,
  issueId: row.issueId,
  releaseId: row.releaseId,
  commitSha: row.commitSha,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.createdAt),
  archivedAt: null,
});

// SQL condition on `issue_to_release`: links whose issue and release the user can see.
export function visibleLinksSql(userId: string): SQL {
  return and(
    inArray(
      issueToRelease.issueId,
      db
        .select({ id: issue.id })
        .from(issue)
        .where(inArray(issue.teamId, visibleTeamIds(userId))),
    ),
    inArray(
      issueToRelease.releaseId,
      db.select({ id: release.id }).from(release).where(visibleReleasesSql(userId)),
    ),
  )!;
}

// SQL condition on `issue`: issues in the release.
export const inReleaseSql = (releaseId: string): SQL =>
  inArray(
    issue.id,
    db
      .select({ id: issueToRelease.issueId })
      .from(issueToRelease)
      .where(eq(issueToRelease.releaseId, releaseId)),
  );

const IDENTIFIER = /^([A-Za-z0-9]+)-(\d{1,9})$/;

// The id of the issue named by a uuid or an identifier ("ENG-12", any case) that the
// user can see, or 404.
async function visibleIssue(
  userId: string,
  idOrIdentifier: unknown,
): Promise<{ id: string; teamId: string }> {
  const notFound = new HttpError(404, `Issue ${String(idOrIdentifier)} not found`);
  if (typeof idOrIdentifier !== 'string') throw notFound;
  let match: SQL | undefined;
  if (UUID_RE.test(idOrIdentifier)) match = eq(issue.id, idOrIdentifier);
  else {
    const m = IDENTIFIER.exec(idOrIdentifier);
    if (m)
      match = and(
        inArray(
          issue.teamId,
          db.select({ id: team.id }).from(team).where(eq(team.key, m[1]!.toUpperCase())),
        ),
        eq(issue.sequenceNumber, Number(m[2])),
      );
  }
  if (!match) throw notFound;
  const [row] = await db
    .select({ id: issue.id, teamId: issue.teamId })
    .from(issue)
    .where(and(match, inArray(issue.teamId, visibleTeamIds(userId))));
  if (!row) throw notFound;
  return row;
}

async function assertTeamInPipeline(teamId: string, pipelineId: string): Promise<void> {
  const [inPipeline] = await db
    .select({ teamId: releasePipelineTeam.teamId })
    .from(releasePipelineTeam)
    .where(
      and(eq(releasePipelineTeam.pipelineId, pipelineId), eq(releasePipelineTeam.teamId, teamId)),
    );
  if (!inPipeline)
    throw new HttpError(400, "The issue's team is not one of the release pipeline's teams");
}

// Linear's issueToReleaseCreate: an existing link is a conflict, as in Linear.
export async function addIssueToRelease(
  user: AuthUser | undefined | null,
  input: { id?: string; issueId?: unknown; releaseId?: unknown; commitSha?: string | null },
): Promise<IssueToReleaseDto> {
  if (typeof input.releaseId !== 'string') throw new HttpError(400, 'releaseId is required');
  const target = await assertReleaseRead(user, input.releaseId);
  await assertPipelineWrite(user, target.pipelineId);
  const found = await visibleIssue(user!.id, input.issueId);
  await assertTeamInPipeline(found.teamId, target.pipelineId);
  try {
    const [row] = await db
      .insert(issueToRelease)
      .values({
        ...(input.id ? { id: input.id } : {}),
        issueId: found.id,
        releaseId: target.id,
        commitSha: input.commitSha ?? null,
      })
      .returning();
    return mapIssueToRelease(row!);
  } catch (err) {
    if (pgErrorCode(err) === '23505')
      throw new HttpError(409, 'The issue is already in the release');
    throw err;
  }
}

// The link when the user can see it, else 404.
export async function getIssueToRelease(
  user: AuthUser | undefined | null,
  id: string,
): Promise<IssueToReleaseDto> {
  const notFound = new HttpError(404, `Issue to release ${id} not found`);
  if (!user || !UUID_RE.test(id)) throw notFound;
  const [row] = await db
    .select()
    .from(issueToRelease)
    .where(and(eq(issueToRelease.id, id), visibleLinksSql(user.id)));
  if (!row) throw notFound;
  return mapIssueToRelease(row);
}

// Removes a link by its id; returns the id.
export async function removeIssueToRelease(
  user: AuthUser | undefined | null,
  id: string,
): Promise<string> {
  const link = await getIssueToRelease(user, id);
  const target = await assertReleaseRead(user, link.releaseId);
  await assertPipelineWrite(user, target.pipelineId);
  await db.delete(issueToRelease).where(eq(issueToRelease.id, id));
  return id;
}

// Removes the issue (uuid or identifier) from the release; returns the link's id.
export async function removeIssueFromRelease(
  user: AuthUser | undefined | null,
  issueIdOrIdentifier: string,
  releaseId: string,
): Promise<string> {
  const target = await assertReleaseRead(user, releaseId);
  await assertPipelineWrite(user, target.pipelineId);
  const found = await visibleIssue(user!.id, issueIdOrIdentifier);
  const [row] = await db
    .delete(issueToRelease)
    .where(and(eq(issueToRelease.issueId, found.id), eq(issueToRelease.releaseId, target.id)))
    .returning({ id: issueToRelease.id });
  if (!row) throw new HttpError(404, 'The issue is not in the release');
  return row.id;
}

// The number of issues in the release the viewer can see (archived ones on request).
export async function releaseIssueCount(
  releaseId: string,
  viewerId: string,
  includeArchived: boolean,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issue)
    .where(
      and(
        inReleaseSql(releaseId),
        inArray(issue.teamId, visibleTeamIds(viewerId)),
        includeArchived ? undefined : sql`${issue.archivedAt} IS NULL`,
      ),
    );
  return row?.n ?? 0;
}
