import {
  db,
  issue,
  issueRelation,
  issueSubscription,
  teamMember,
  project,
  projectMilestone,
  team,
  workflowState,
  user,
} from '@repo/db';
import {
  and,
  eq,
  inArray,
  isNull,
  not,
  notInArray,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';
import { teamFilter, visibleTeamIds } from './resolvers/team';
import { stateFilter } from './resolvers/workflow-state';
import { gqlError } from './errors';
import { cycleFilterHandlers, cycleIdsMatching } from './cycle-filter';
import { attachmentCollectionFilter } from './attachment-filter';
import { labelCollectionSql } from './label-collection-filter';
import {
  customerCountFilter,
  customerImportantCountFilter,
  needCollectionFilter,
} from './customer-need-filter';
import { shownNameSql } from '../shared/user-name';

// IssueFilter as SQL over the issue table. Supported: id, number, title,
// description, priority, estimate, createdAt, updatedAt, completedAt, dueDate,
// team (id, key, name), state (id, name, type, team), assignee, delegate and creator (id, name,
// email, isMe, null), parent (id, null), project, projectMilestone, cycle,
// hasBlockingRelations, hasBlockedByRelations, hasDuplicateRelations,
// hasRelatedRelations, attachments, labels and subscribers (some, every, length and their
// fields), sourceMetadata (null, workflowDefinitionId), needs (feedback: some, every,
// length and its fields), customerCount and customerImportantCount (people asking), and
// / or.
// Anything else is INVALID_INPUT.

// A NullableUserFilter on one of the issue's user columns. isMe compares with the
// viewer; `null: true` matches issues with no user set.
// The user fields an issue's user filters support, as SQL over the user table.
function userHandlers(viewerId: string): FieldHandlers {
  return {
    id: (v, p) => compareId(user.id, v, p),
    name: (v, p) => compare(shownNameSql, v, p),
    email: (v, p) => compare(user.email, v, p),
    isMe: (v, p) => {
      const { eq: me, ...other } = v as Record<string, unknown>;
      if (Object.keys(other).length)
        throw gqlError('INVALID_INPUT', `Filter ${p} supports eq only`);
      return me ? eq(user.id, viewerId) : not(eq(user.id, viewerId));
    },
  };
}

function userOn(column: AnyColumn, viewerId: string) {
  return (value: unknown, path: string): SQL => {
    const { null: isNullFilter, ...rest } = value as Record<string, unknown>;
    const users = filterSql(rest, userHandlers(viewerId), path);
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

// A RelationExistsComparator ({ eq, neq }) on whether the issue is in `withRelation`
// (a subquery of issue ids).
function relationExists(withRelation: () => SQL) {
  return (value: unknown, path: string): SQL => {
    const { eq: equals, neq, ...rest } = value as Record<string, unknown>;
    if (Object.keys(rest).length)
      throw gqlError('INVALID_INPUT', `Filter ${path}.${Object.keys(rest)[0]} is not supported`);
    const parts: SQL[] = [];
    for (const [want, v] of [
      [true, equals],
      [false, neq],
    ] as const) {
      if (v === undefined || v === null) continue;
      parts.push(
        v === want ? inArray(issue.id, withRelation()) : notInArray(issue.id, withRelation()),
      );
    }
    return and(...parts) ?? sql`true`;
  };
}

// IssueFilter.subscribers (UserCollectionFilter) over the issue's subscribers who are
// members of its team: `some` / `every` match them, `length` compares their count,
// and the direct user fields mean "some subscriber matches".
function subscribersFilter(viewerId: string) {
  const users = userHandlers(viewerId);
  // Correlated with the outer issue row.
  const subscribers = (match: SQL | undefined) => sql`(
    SELECT 1 FROM ${issueSubscription}
    JOIN ${user} ON ${user.id} = ${issueSubscription.userId}
    JOIN ${teamMember} ON ${teamMember.userId} = ${issueSubscription.userId}
      AND ${teamMember.teamId} = ${issue.teamId}
    WHERE ${issueSubscription.issueId} = ${issue.id} AND ${match ?? sql`true`}
  )`;
  const handlers: FieldHandlers = {
    ...Object.fromEntries(
      Object.entries(users).map(([key, handler]) => [
        key,
        (v: unknown, p: string) => sql`EXISTS ${subscribers(handler(v, p))}`,
      ]),
    ),
    some: (v, p) => sql`EXISTS ${subscribers(filterSql(v, users, p))}`,
    every: (v, p) => {
      const match = filterSql(v, users, p);
      // A NULL comparison is not a match, so it counts as a violation.
      return match
        ? sql`NOT EXISTS ${subscribers(sql`NOT COALESCE((${match}), false)`)}`
        : sql`true`;
    },
    length: (v, p) => compare(sql`(SELECT count(*) FROM ${subscribers(undefined)} AS s)`, v, p),
  };
  return (value: unknown, path: string): SQL => filterSql(value, handlers, path) ?? sql`true`;
}

// Relation existence counts only relations to issues the viewer can see.
function relationFilters(viewerId: string): FieldHandlers {
  const visible = () =>
    db
      .select({ id: issue.id })
      .from(issue)
      .where(inArray(issue.teamId, visibleTeamIds(viewerId)));
  // The issues on one side of relations of `type` whose other side is visible.
  const side = (type: string, column: 'issueId' | 'relatedIssueId') => {
    const other = column === 'issueId' ? issueRelation.relatedIssueId : issueRelation.issueId;
    return db
      .select({ id: issueRelation[column] })
      .from(issueRelation)
      .where(and(eq(issueRelation.type, type), inArray(other, visible())));
  };
  const eitherSide = (type: string) =>
    sql`(${side(type, 'issueId')} UNION ${side(type, 'relatedIssueId')})`;
  return {
    hasBlockingRelations: relationExists(() => sql`(${side('blocks', 'issueId')})`),
    hasBlockedByRelations: relationExists(() => sql`(${side('blocks', 'relatedIssueId')})`),
    hasDuplicateRelations: relationExists(() => eitherSide('duplicate')),
    hasRelatedRelations: relationExists(() => eitherSide('related')),
  };
}

// IssueFilter.sourceMetadata (SourceMetadataComparator): how the issue was created.
// Every issue here is created by a person or a token (no integration, intake source or
// creating workflow), so `null: true` matches every issue and the creating workflow's
// id is null for all of them.
function sourceMetadataFilter(value: unknown, path: string): SQL {
  const { null: isNullFilter, workflowDefinitionId, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length)
    throw gqlError('INVALID_INPUT', `Filter ${path}.${Object.keys(rest)[0]} is not supported`);
  const parts: SQL[] = [];
  if (isNullFilter !== undefined && isNullFilter !== null)
    parts.push(isNullFilter ? sql`true` : sql`false`);
  if (workflowDefinitionId !== undefined && workflowDefinitionId !== null)
    parts.push(compareId(sql`NULL::uuid`, workflowDefinitionId, `${path}.workflowDefinitionId`));
  return and(...parts) ?? sql`true`;
}

export function issueFilterSql(filter: unknown, viewerId: string): SQL | undefined {
  const handlers: FieldHandlers = {
    ...relationFilters(viewerId),
    id: (v, p) => compareId(issue.id, v, p),
    number: (v, p) => compare(issue.sequenceNumber, v, p),
    title: (v, p) => compare(issue.title, v, p),
    description: (v, p) => compare(issue.description, v, p),
    priority: (v, p) => compare(issue.priority, v, p),
    estimate: (v, p) => compare(issue.estimate, v, p),
    createdAt: (v, p) => compare(issue.createdAt, v, p),
    updatedAt: (v, p) => compare(issue.updatedAt, v, p),
    completedAt: (v, p) => compare(issue.completedAt, v, p),
    archivedAt: (v, p) => compare(issue.archivedAt, v, p),
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
    creator: userOn(issue.creatorUserId, viewerId),
    parent: parentFilter,
    attachments: attachmentCollectionFilter(viewerId),
    labels: labelCollectionSql,
    subscribers: subscribersFilter(viewerId),
    sourceMetadata: sourceMetadataFilter,
    needs: needCollectionFilter(viewerId),
    customerCount: customerCountFilter,
    customerImportantCount: customerImportantCountFilter,
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
