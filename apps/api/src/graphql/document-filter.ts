import { db, document, issue, projectTeam } from '@repo/db';
import { inArray, or, sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// DocumentFilter as SQL over the document table. Supported: id, title, slugId,
// createdAt, updatedAt, creator (id), owner (id, null), project (id), issue (id),
// team (id: the issue's team or one of the project's teams), and / or. Anything
// else is INVALID_INPUT.

const idOnly = (column: Parameters<typeof compareId>[0]) => (value: unknown, path: string) =>
  filterSql(value, { id: (v, p) => compareId(column, v, p) }, path) ?? sql`true`;

const teamHandler = (value: unknown, path: string): SQL => {
  const teamIds = (comp: (col: Parameters<typeof compareId>[0]) => SQL) =>
    or(
      inArray(
        document.projectId,
        db.select({ id: projectTeam.projectId }).from(projectTeam).where(comp(projectTeam.teamId)),
      ),
      inArray(document.issueId, db.select({ id: issue.id }).from(issue).where(comp(issue.teamId))),
    )!;
  return (
    filterSql(value, { id: (v, p) => teamIds((col) => compareId(col, v, p)) }, path) ?? sql`true`
  );
};

const handlers: FieldHandlers = {
  id: (v, p) => compareId(document.id, v, p),
  title: (v, p) => compare(document.title, v, p),
  slugId: (v, p) => compare(document.slugId, v, p),
  createdAt: (v, p) => compare(document.createdAt, v, p),
  updatedAt: (v, p) => compare(document.updatedAt, v, p),
  creator: idOnly(document.creatorUserId),
  owner: (v, p) => refFilter(document.ownerUserId, v, p),
  project: idOnly(document.projectId),
  issue: idOnly(document.issueId),
  team: teamHandler,
};

export function documentFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, handlers);
}
