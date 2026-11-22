import { db, issue, project, projectMilestone, team, workflowState, user } from '@repo/db';
import { eq, inArray, isNull, not, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';
import { teamFilter } from './resolvers/team';
import { stateFilter } from './resolvers/workflow-state';
import { gqlError } from './errors';
import { cycleFilterHandlers, cycleIdsMatching } from './cycle-filter';

// IssueFilter as SQL over the issue table. Supported: id, number, title,
// description, priority, estimate, createdAt, updatedAt, completedAt, dueDate,
// team (id, key, name), state (id, name, type, team), assignee and delegate (id, name,
// email, isMe, null), parent (id, null), project, projectMilestone, cycle, and / or.
// Anything else is INVALID_INPUT.

// A NullableUserFilter on one of the issue's user columns. isMe compares with the
// viewer; `null: true` matches issues with no user set.
function userOn(column: AnyColumn, viewerId: string) {
  return (value: unknown, path: string): SQL => {
    const { null: isNullFilter, ...rest } = value as Record<string, unknown>;
    const handlers: FieldHandlers = {
      id: (v, p) => compareId(user.id, v, p),
      name: (v, p) => compare(user.name, v, p),
      email: (v, p) => compare(user.email, v, p),
      isMe: (v, p) => {
        const { eq: me, ...other } = v as Record<string, unknown>;
        if (Object.keys(other).length)
          throw gqlError('INVALID_INPUT', `Filter ${p} supports eq only`);
        return me ? eq(user.id, viewerId) : not(eq(user.id, viewerId));
      },
    };
    const users = filterSql(rest, handlers, path);
    const parts: SQL[] = [];
    if (isNullFilter !== undefined)
      parts.push(isNullFilter ? isNull(column) : sql`${column} IS NOT NULL`);
    if (users) parts.push(inArray(column, db.select({ id: user.id }).from(user).where(users)));
    return parts.length === 1 ? parts[0]! : sql`(${sql.join(parts, sql` AND `)})`;
  };
}

function parentFilter(value: unknown, path: string): SQL {
  const { null: isNullFilter, id, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length)
    throw gqlError('INVALID_INPUT', `Filter ${path}.${Object.keys(rest)[0]} is not supported`);
  const parts: SQL[] = [];
  if (isNullFilter !== undefined)
    parts.push(isNullFilter ? isNull(issue.parentId) : sql`${issue.parentId} IS NOT NULL`);
  if (id !== undefined) parts.push(compareId(issue.parentId, id, `${path}.id`));
  return parts.length ? sql`(${sql.join(parts, sql` AND `)})` : sql`true`;
}

// A nullable reference filter ({ null, ...fields }) on an issue column pointing at
// `table`'s id: `null: true` matches unset, the other fields match the referenced row.
function nullableRef(
  column: AnyColumn,
  value: unknown,
  path: string,
  handlers: FieldHandlers,
  table: typeof project | typeof projectMilestone,
): SQL {
  const { null: isNullFilter, ...rest } = value as Record<string, unknown>;
  const parts: SQL[] = [];
  if (isNullFilter !== undefined)
    parts.push(isNullFilter ? isNull(column) : sql`${column} IS NOT NULL`);
  const match = filterSql(rest, handlers, path);
  if (match) parts.push(inArray(column, db.select({ id: table.id }).from(table).where(match)));
  return parts.length ? sql`(${sql.join(parts, sql` AND `)})` : sql`true`;
}

export function issueFilterSql(filter: unknown, viewerId: string): SQL | undefined {
  const handlers: FieldHandlers = {
    id: (v, p) => compareId(issue.id, v, p),
    number: (v, p) => compare(issue.sequenceNumber, v, p),
    title: (v, p) => compare(issue.title, v, p),
    description: (v, p) => compare(issue.description, v, p),
    priority: (v, p) => compare(issue.priority, v, p),
    estimate: (v, p) => compare(issue.estimate, v, p),
    createdAt: (v, p) => compare(issue.createdAt, v, p),
    updatedAt: (v, p) => compare(issue.updatedAt, v, p),
    completedAt: (v, p) => compare(issue.completedAt, v, p),
    dueDate: (v, p) => compare(issue.dueDate, v, p),
    team: (v, p) =>
      inArray(
        issue.teamId,
        db
          .select({ id: team.id })
          .from(team)
          .where(filterSql(v, teamFilter, p)),
      ),
    state: (v, p) =>
      inArray(
        issue.stateId,
        db
          .select({ id: workflowState.id })
          .from(workflowState)
          .where(filterSql(v, stateFilter, p)),
      ),
    assignee: userOn(issue.assigneeUserId, viewerId),
    delegate: userOn(issue.delegateUserId, viewerId),
    parent: parentFilter,
    project: (v, p) =>
      nullableRef(
        issue.projectId,
        v,
        p,
        {
          id: (x, q) => compareId(project.id, x, q),
          name: (x, q) => compare(project.name, x, q),
        },
        project,
      ),
    // NullableCycleFilter: `null: true` matches issues outside any cycle; the other
    // fields (id, number, isActive, isNext, isPrevious, …) match the cycle.
    cycle: (v, p) => {
      const { null: isNullFilter, ...rest } = v as Record<string, unknown>;
      const parts: SQL[] = [];
      if (isNullFilter !== undefined)
        parts.push(isNullFilter ? isNull(issue.cycleId) : sql`${issue.cycleId} IS NOT NULL`);
      const match = filterSql(rest, cycleFilterHandlers, p);
      if (match) parts.push(inArray(issue.cycleId, cycleIdsMatching(match)));
      return parts.length ? sql`(${sql.join(parts, sql` AND `)})` : sql`true`;
    },
    projectMilestone: (v, p) =>
      nullableRef(
        issue.projectMilestoneId,
        v,
        p,
        {
          id: (x, q) => compareId(projectMilestone.id, x, q),
          name: (x, q) => compare(projectMilestone.name, x, q),
        },
        projectMilestone,
      ),
  };
  return filterSql(filter, handlers);
}
