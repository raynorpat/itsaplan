import {
  attachment,
  customer,
  customerNeed,
  cycle,
  issue,
  issueLabel,
  issueToRelease,
  label,
  project,
  projectMilestone,
  release,
  team,
  user,
  workflowState,
} from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { customerCountSql } from '../feedback/store';
import { visibleReleasesSql } from '../releases/store';
import { shownNameSql } from '../shared/user-name';
import { visibleUsers } from './resolvers/team';
import { parseCaselessSort, parseSortInput, type SortBuilder, type SortKey } from './sort';

// Linear's IssueSortInput as sort keys (graphql/sort.ts). Each key reads a column of
// the issue row the builders are given, so `rootIssue` can apply any key to an issue's
// top ancestor. Keys follow the descriptions in Linear's schema: cycle by start date,
// project by name, milestone by target date, release by the most recent release date,
// customer by name, customer revenue by revenue. An issue with several values (labels,
// customers) sorts ascending by its lowest and descending by its highest. A related item
// the viewer cannot see sorts as empty: people outside the viewer's reach (an assignee
// who left the team, for a guest), releases of pipelines the viewer cannot see (a
// pipeline's teams can change after its issues were added), and customers for a viewer
// who cannot read them or while Customers is off. Projects and cycles include the
// issue's team, so they are visible whenever the issue is.

// A column of the issue row being sorted.
type IssueColumn = (name: string) => SQL;

const outerIssue: IssueColumn = (name) => sql.raw(`"issue"."${name}"`);
const ROOT_ALIAS = 'root_issue';
const rootIssueColumn: IssueColumn = (name) => sql.raw(`"${ROOT_ALIAS}"."${name}"`);

const minOrMax = (order: 'asc' | 'desc') => (order === 'asc' ? sql`min` : sql`max`);

// Linear's state type order; within a type, the column position.
const STATE_TYPE_RANK = sql`CASE ${workflowState.stateType}
  WHEN 'triage' THEN 0 WHEN 'backlog' THEN 1 WHEN 'unstarted' THEN 2
  WHEN 'started' THEN 3 WHEN 'completed' THEN 4 WHEN 'canceled' THEN 5 ELSE 6 END`;

interface Viewer {
  id: string;
  readsCustomers: boolean;
}

function builders(col: IssueColumn, viewer: Viewer): Record<string, SortBuilder> {
  const { readsCustomers } = viewer;
  const userName = (column: string): SQL =>
    sql`(SELECT ${shownNameSql} FROM ${user} WHERE ${user.id} = ${col(column)} AND ${visibleUsers(viewer.id)})`;
  const stateOf = (expr: SQL): SQL =>
    sql`(SELECT ${expr} FROM ${workflowState} WHERE ${workflowState.id} = ${col('state_id')})`;
  const empty = (type: 'text' | 'number'): SQL =>
    type === 'text' ? sql`NULL::text` : sql`NULL::numeric`;

  const all: Record<string, SortBuilder> = {
    assignee: () => [{ sql: userName('assignee_user_id'), type: 'text' }],
    delegate: () => [{ sql: userName('delegate_user_id'), type: 'text' }],
    completedAt: () => [{ sql: col('completed_at'), type: 'timestamp' }],
    createdAt: () => [{ sql: col('created_at'), type: 'timestamp' }],
    updatedAt: () => [{ sql: col('updated_at'), type: 'timestamp' }],
    dueDate: () => [{ sql: col('due_date'), type: 'date' }],
    estimate: () => [{ sql: col('estimate'), type: 'number' }],
    title: () => [{ sql: col('title'), type: 'text' }],
    manual: () => [{ sql: col('position'), type: 'number' }],
    priority: (options) => [
      {
        sql: sql`(CASE WHEN ${col('priority')} = 0 THEN ${options.noPriorityFirst ? 0 : 5} ELSE ${col('priority')} END)`,
        type: 'number',
      },
    ],
    team: () => [
      {
        sql: sql`(SELECT ${team.name} FROM ${team} WHERE ${team.id} = ${col('team_id')})`,
        type: 'text',
      },
    ],
    project: () => [
      {
        sql: sql`(SELECT ${project.name} FROM ${project} WHERE ${project.id} = ${col('project_id')})`,
        type: 'text',
      },
    ],
    milestone: () => [
      {
        sql: sql`(SELECT ${projectMilestone.targetDate} FROM ${projectMilestone} WHERE ${projectMilestone.id} = ${col('project_milestone_id')})`,
        type: 'date',
      },
    ],
    cycle: (options) => {
      const startsAt: SortKey['sql'] = sql`(SELECT ${cycle.startsAt} FROM ${cycle} WHERE ${cycle.id} = ${col('cycle_id')})`;
      if (!options.currentCycleFirst) return [{ sql: startsAt, type: 'timestamp' }];
      return [
        {
          sql: sql`(SELECT CASE WHEN ${cycle.startsAt} <= now() AND now() < ${cycle.endsAt} THEN 0 ELSE 1 END FROM ${cycle} WHERE ${cycle.id} = ${col('cycle_id')})`,
          type: 'number',
          order: 'asc',
        },
        { sql: startsAt, type: 'timestamp' },
      ];
    },
    label: (_, order) => [
      {
        sql: sql`(SELECT ${minOrMax(order)}(${label.name}) FROM ${issueLabel} JOIN ${label} ON ${label.id} = ${issueLabel.labelId} WHERE ${issueLabel.issueId} = ${col('id')})`,
        type: 'text',
      },
    ],
    labelGroup: (options, order) => [
      {
        sql: sql`(SELECT ${minOrMax(order)}(${label.name}) FROM ${issueLabel} JOIN ${label} ON ${label.id} = ${issueLabel.labelId} WHERE ${issueLabel.issueId} = ${col('id')} AND ${label.parentId}::text = ${String(options.labelGroupId ?? '')})`,
        type: 'text',
      },
    ],
    // Links are the issue's attachments; a feedback item's source attachment is not one.
    linkCount: () => [
      {
        sql: sql`(SELECT count(*)::int FROM ${attachment} WHERE ${attachment.issueId} = ${col('id')} AND ${attachment.sourceType} IS DISTINCT FROM 'feedback')`,
        type: 'number',
      },
    ],
    release: () => [
      {
        sql: sql`(SELECT max(${release.completedAt}) FROM ${issueToRelease} JOIN ${release} ON ${release.id} = ${issueToRelease.releaseId} WHERE ${issueToRelease.issueId} = ${col('id')} AND ${release.trashed} = false AND ${release.archivedAt} IS NULL AND ${visibleReleasesSql(viewer.id)})`,
        type: 'timestamp',
      },
    ],
    customerCount: () => [{ sql: customerCountSql(false, col('id')), type: 'number' }],
    customerImportantCount: () => [{ sql: customerCountSql(true, col('id')), type: 'number' }],
    customer: (_, order) => [
      {
        sql: readsCustomers
          ? sql`(SELECT ${minOrMax(order)}(${customer.name}) FROM ${customerNeed} JOIN ${customer} ON ${customer.id} = ${customerNeed.customerId} WHERE ${customerNeed.issueId} = ${col('id')} AND ${customerNeed.archivedAt} IS NULL)`
          : empty('text'),
        type: 'text',
      },
    ],
    // The revenue of the largest customer asking, in both directions.
    customerRevenue: () => [
      {
        sql: readsCustomers
          ? sql`(SELECT max(${customer.revenue}) FROM ${customerNeed} JOIN ${customer} ON ${customer.id} = ${customerNeed.customerId} WHERE ${customerNeed.issueId} = ${col('id')} AND ${customerNeed.archivedAt} IS NULL)`
          : empty('number'),
        type: 'number',
      },
    ],
    // The state type in Linear's order, then (unless typeOnly) the column position.
    // closedIssuesOrderedByRecency puts completed and canceled issues most recently
    // closed first within their type.
    workflowState: (options) => {
      const parts: ReturnType<SortBuilder> = [{ sql: stateOf(STATE_TYPE_RANK), type: 'number' }];
      if (options.closedIssuesOrderedByRecency)
        parts.push({
          sql: sql`(CASE WHEN ${stateOf(sql`${workflowState.stateType}`)} IN ('completed', 'canceled') THEN coalesce(${col('completed_at')}, ${col('canceled_at')}) END)`,
          type: 'timestamp',
          order: 'desc',
          nulls: 'last',
        });
      if (!options.typeOnly)
        parts.push({ sql: stateOf(sql`${workflowState.position}`), type: 'number' });
      return parts;
    },
  };

  // The nested sort applied to the issue's top ancestor (the issue itself without a
  // parent). The nested key's own order and null placement apply when given, else
  // RootIssueSort's.
  all.rootIssue = (options) => {
    const nested = parseSortInput(
      [withOuterOrder(options.sort, options)],
      builders(rootIssueColumn, viewer),
      'sort.rootIssue.sort',
    );
    const rootId = sql`(WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT ri.id, ri.parent_id, 0 FROM ${issue} ri WHERE ri.id = ${col('id')}
      UNION ALL
      SELECT p.id, p.parent_id, up.depth + 1 FROM ${issue} p JOIN up ON p.id = up.parent_id WHERE up.depth < 50
    ) SELECT id FROM up ORDER BY depth DESC LIMIT 1)`;
    return (nested ?? []).map((key) => ({
      ...key,
      sql: sql`(SELECT ${key.sql} FROM ${issue} ${sql.raw(`"${ROOT_ALIAS}"`)} WHERE ${rootIssueColumn('id')} = ${rootId})`,
    }));
  };
  return all;
}

// The keys a `sort: [IssueSortInput!]` argument asks for on the outer `issue` row, or
// null when it asks for none. `slaStatus` is INVALID_INPUT (no SLAs here).
export function issueSortKeys(
  input: unknown,
  viewerId: string,
  readsCustomers: boolean,
): SortKey[] | null {
  return parseCaselessSort(input, builders(outerIssue, { id: viewerId, readsCustomers }));
}

// RootIssueSort's nested sort (one key) with `order` / `nulls` taken from the outer sort
// where the nested key leaves them out.
function withOuterOrder(nested: unknown, outer: Record<string, unknown>): unknown {
  if (!nested || typeof nested !== 'object') return nested;
  return Object.fromEntries(
    Object.entries(nested as Record<string, unknown>).map(([name, value]) => {
      if (value == null || typeof value !== 'object') return [name, value];
      const opts = value as Record<string, unknown>;
      return [
        name,
        { ...opts, order: opts.order ?? outer.order, nulls: opts.nulls ?? outer.nulls },
      ];
    }),
  );
}

// After the keys: the manual order, then newest first (and the id, added by
// paginateSorted), the same chain the web app breaks ties with.
export const issueTieBreak: SortKey[] = [
  { sql: sql`${issue.position}`, order: 'asc', nulls: 'last', type: 'number' },
  { sql: sql`${issue.createdAt}`, order: 'desc', nulls: 'last', type: 'timestamp' },
];
