import {
  db,
  initiative,
  initiativeToProject,
  project,
  projectStatus,
  projectTeam,
  team,
  user,
} from '@repo/db';
import { and, eq, inArray, isNull, not, notInArray, sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';
import { gqlError } from './errors';
import { teamFilter } from './resolvers/team';
import { initiativeFilterSql } from './initiative-filter';
import { initiativesVisibleThrough } from '../initiatives/access';
import { shownNameSql } from '../shared/user-name';

// ProjectFilter as SQL over the project table. Supported: id, name, slugId,
// status (id, name, type), lead (id, name, email, isMe, null), priority,
// startDate, targetDate, createdAt, updatedAt, accessibleTeams (some), initiatives
// (some, every, length; over visible, unarchived initiatives), and / or.
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
          name: (x, q) => compare(shownNameSql, x, q),
          email: (x, q) => compare(user.email, x, q),
          isMe: (x) =>
            (x as { eq?: boolean }).eq ? eq(user.id, viewerId) : not(eq(user.id, viewerId)),
        },
        p,
      );
      return inArray(project.leadUserId, db.select({ id: user.id }).from(user).where(users));
    },
    initiatives: (v, p) => {
      const { some, every, length, ...rest } = v as Record<string, unknown>;
      if (Object.keys(rest).length)
        throw gqlError('INVALID_INPUT', `Filter ${p}.${Object.keys(rest)[0]} is not supported`);
      // The projects linked to a visible, unarchived initiative matching `cond`.
      const linkedWhere = (cond: SQL | undefined) =>
        db
          .select({ id: initiativeToProject.projectId })
          .from(initiativeToProject)
          .innerJoin(initiative, eq(initiative.id, initiativeToProject.initiativeId))
          .where(
            and(initiativesVisibleThrough(readableTeamIds), isNull(initiative.archivedAt), cond),
          );
      const parts: SQL[] = [];
      if (some != null)
        parts.push(inArray(project.id, linkedWhere(initiativeFilterSql(some, `${p}.some`))));
      if (every != null) {
        const cond = initiativeFilterSql(every, `${p}.every`);
        // A NULL comparison is not a match, so it counts as a violation too.
        if (cond)
          parts.push(notInArray(project.id, linkedWhere(sql`NOT COALESCE((${cond}), false)`)));
      }
      if (length != null) {
        const count = sql`(
          SELECT count(*)::int FROM initiative_to_project itp
          JOIN initiative ON initiative.id = itp.initiative_id
          WHERE itp.project_id = ${project.id} AND initiative.archived_at IS NULL
            AND ${initiativesVisibleThrough(readableTeamIds)}
        )`;
        parts.push(compare(count, length, `${p}.length`));
      }
      return and(...parts) ?? sql`true`;
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
