import { db, releasePipeline, releasePipelineTeam } from '@repo/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { assertWorkspaceRole, requireUser, visibleTeamIds, type AuthUser } from '../shared/access';
import { HttpError, UUID_RE } from '../shared/lib';

// Who reaches a release pipeline and everything in it (stages, releases, notes, keys):
// whoever can see one of its teams reads it; owners, admins and members who can see it
// change it; guests only read (and app users, which read as guests).

// SQL condition on `release_pipeline`: a pipeline with a team the user can see.
export function visiblePipelinesSql(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${releasePipelineTeam}
    WHERE ${releasePipelineTeam.pipelineId} = ${releasePipeline.id}
      AND ${inArray(releasePipelineTeam.teamId, visibleTeamIds(userId))})`;
}

// The pipeline (archived and trashed included) when the user may read it, else 404.
export async function assertPipelineRead(
  user: AuthUser | undefined | null,
  id: string,
): Promise<typeof releasePipeline.$inferSelect> {
  const viewer = requireUser(user);
  const notFound = new HttpError(404, `Release pipeline ${id} not found`);
  // Linear's id arguments also take the slug.
  const key = UUID_RE.test(id) ? eq(releasePipeline.id, id) : eq(releasePipeline.slugId, id);
  const [row] = await db
    .select()
    .from(releasePipeline)
    .where(and(key, visiblePipelinesSql(viewer.id)));
  if (!row) throw notFound;
  return row;
}

// The pipeline when the user may change it: they read it and are a member or above.
export async function assertPipelineWrite(
  user: AuthUser | undefined | null,
  id: string,
): Promise<typeof releasePipeline.$inferSelect> {
  const row = await assertPipelineRead(user, id);
  await assertWorkspaceRole(user, 'member');
  return row;
}
