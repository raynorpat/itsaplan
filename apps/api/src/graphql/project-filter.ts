import { db, project, projectStatus, projectTeam, team, user } from '@repo/db';
import { and, eq, inArray, not, sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';
import { gqlError } from './errors';
import { teamFilter } from './resolvers/team';

// ProjectFilter as SQL over the project table. Supported: id, name, slugId,
// status (id, name, type), lead (id, name, email, isMe, null), priority,
// startDate, targetDate, createdAt, updatedAt, accessibleTeams (some), and / or.
// Anything else is INVALID_INPUT.

const NO_ID = '00000000-0000-0000-0000-000000000000';

const statusFilter: FieldHandlers = {
  id: (v, p) => compareId(projectStatus.id, v, p),
  name: (v, p) => compare(projectStatus.name, v, p),
  type: (v, p) => compare(projectStatus.type, v, p),
};

// accessibleTeams matches only teams in `readableTeamIds`, so a filter cannot
// reveal that a project is in a team the viewer cannot access.
export function projectFilterSql(
  filter: unknown,
  viewerId: string,
  readableTeamIds: string[],
): SQL | undefined {
  const handlers: FieldHandlers = {
    id: (v, p) => compareId(project.id, v, p),
    name: (v, p) => compare(project.name, v, p),
    slugId: (v, p) => compare(project.slugId, v, p),
    priority: (v, p) => compare(project.priority, v, p),
    startDate: (v, p) => compare(project.startDate, v, p),
    targetDate: (v, p) => compare(project.targetDate, v, p),
    createdAt: (v, p) => compare(project.createdAt, v, p),
    updatedAt: (v, p) => compare(project.updatedAt, v, p),
    status: (v, p) =>
      inArray(
        project.statusId,
        db
          .select({ id: projectStatus.id })
          .from(projectStatus)
          .where(filterSql(v, statusFilter, p)),
      ),
    lead: (v, p) => {
      const { null: isNull, ...rest } = v as Record<string, unknown>;
      if (isNull !== undefined)
        return isNull ? sql`${project.leadUserId} IS NULL` : sql`${project.leadUserId} IS NOT NULL`;
      const users = filterSql(
        rest,
        {
          id: (x, q) => compareId(user.id, x, q),
          name: (x, q) => compare(user.name, x, q),
          email: (x, q) => compare(user.email, x, q),
          isMe: (x) =>
            (x as { eq?: boolean }).eq ? eq(user.id, viewerId) : not(eq(user.id, viewerId)),
        },
        p,
      );
      return inArray(project.leadUserId, db.select({ id: user.id }).from(user).where(users));
    },
    accessibleTeams: (v, p) => {
      const { some, ...rest } = v as Record<string, unknown>;
      if (Object.keys(rest).length)
        throw gqlError('INVALID_INPUT', `Filter ${p}.${Object.keys(rest)[0]} is not supported`);
      return inArray(
        project.id,
        db
          .select({ id: projectTeam.projectId })
          .from(projectTeam)
          .innerJoin(team, eq(team.id, projectTeam.teamId))
          .where(
            and(
              inArray(projectTeam.teamId, readableTeamIds.length ? readableTeamIds : [NO_ID]),
              filterSql(some, teamFilter, `${p}.some`),
            ),
          ),
      );
    },
  };
  return filterSql(filter, handlers);
}
