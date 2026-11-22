// Client-side filter model and matching engine for the team views. A view's
// filters are stored in the DB (kanban_views.filters) as a FilterSet; the same
// set is applied to every layout (Team, Table, Timeline, Calendar) before the
// issues are handed to the view. The server never inspects this shape.

import type { TeamDetail, StateType, Issue } from '@/lib/api';

// The fields a condition can target. A stored condition on any other field (one
// that is no longer offered) constrains nothing.
export type BuiltinFilterField =
  | 'status' // the issue's column id
  | 'statusType' // the column's state type (backlog/unstarted/…)
  | 'assignee' // assignee id, or null for "no assignee"
  | 'delegate' // delegate agent id, or null for "no delegate"
  | 'priority' // priority string, or null for "no priority"
  | 'labels' // label ids (a issue has any/none of the chosen ones)
  | 'dueDate'
  | 'startDate'
  | 'created'
  | 'updated';

// Operators, grouped by the field kinds they apply to:
// - is / is_not: set membership (a value in / not in the chosen set)
// - before / after: date comparison (single date value)
// - is_set / is_not_set: presence (no value needed)
export type FilterOperator = 'is' | 'is_not' | 'before' | 'after' | 'is_set' | 'is_not_set';

export type FilterValue = string | number | boolean | null;

export interface FilterCondition {
  // Client-only stable key for React lists; not persisted meaningfully.
  id: string;
  // A BuiltinFilterField.
  field: string;
  op: FilterOperator;
  // The chosen values (OR-ed within the condition). Empty for is_set/is_not_set.
  values: FilterValue[];
}

export interface FilterSet {
  conditions: FilterCondition[];
}

export const EMPTY_FILTER_SET: FilterSet = { conditions: [] };

// A FilterSet is only "active" (narrows the team) when it has at least one
// condition. A condition with an empty value set for a value-based operator is
// ignored, so a half-built condition in the UI does not hide everything.
export function isActiveFilterSet(filters: FilterSet | null | undefined): boolean {
  return !!filters && filters.conditions.some(isEffectiveCondition);
}

// Whether a condition actually constrains the result. Presence operators
// (is_set/is_not_set) need no value; every other operator needs at least one.
function isEffectiveCondition(cond: FilterCondition): boolean {
  if (cond.op === 'is_set' || cond.op === 'is_not_set') return true;
  return cond.values.length > 0;
}

// Normalizes any date the store returns to a "YYYY-MM-DD" day for comparison:
// due/start dates are already that; created/updated are ISO datetimes, so the
// date part is sliced off. String comparison on this format orders correctly.
function toDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

// The issue's value(s) for a built-in set-membership field, as an array so
// multi-valued fields (labels) and single-valued ones share one code path. A
// missing value is represented as [null] so an "is No assignee" condition can
// match it.
function builtinSetValues(
  issue: Issue,
  field: BuiltinFilterField,
  columnStateType: Map<string, StateType>,
): FilterValue[] {
  switch (field) {
    case 'status':
      return [issue.stateId];
    case 'statusType':
      return [columnStateType.get(issue.stateId) ?? null];
    case 'assignee':
      return [issue.assigneeUserId];
    case 'delegate':
      return [issue.delegateUserId];
    case 'priority':
      // null is "no priority" (0).
      return [issue.priority || null];
    case 'labels':
      return issue.labelIds.length ? issue.labelIds : [null];
    default:
      return [];
  }
}

// The issue's raw date string for a built-in date field (or null if unset).
function builtinDate(issue: Issue, field: BuiltinFilterField): string | null {
  switch (field) {
    case 'dueDate':
      return issue.dueDate;
    case 'startDate':
      return issue.startDate;
    case 'created':
      return issue.createdAt;
    case 'updated':
      return issue.updatedAt;
    default:
      return null;
  }
}

const DATE_FIELDS: BuiltinFilterField[] = ['dueDate', 'startDate', 'created', 'updated'];

function hasValue(values: FilterValue[]): boolean {
  return values.some((v) => v !== null && v !== '');
}

const SET_FIELDS: BuiltinFilterField[] = [
  'status',
  'statusType',
  'assignee',
  'delegate',
  'priority',
  'labels',
];

// Whether one issue satisfies one condition. A condition on a field that is not
// offered (left in a saved view after the field was removed) matches every issue.
function matchCondition(
  issue: Issue,
  cond: FilterCondition,
  columnStateType: Map<string, StateType>,
): boolean {
  const field = cond.field as BuiltinFilterField;
  const isDate = DATE_FIELDS.includes(field);
  if (!isDate && !SET_FIELDS.includes(field)) return true;

  if (cond.op === 'before' || cond.op === 'after') {
    const day = toDay(builtinDate(issue, field));
    const target = typeof cond.values[0] === 'string' ? (cond.values[0] as string) : null;
    if (!day || !target) return false;
    return cond.op === 'before' ? day < target : day > target;
  }

  if (cond.op === 'is_set' || cond.op === 'is_not_set') {
    const present = isDate
      ? builtinDate(issue, field) != null
      : hasValue(builtinSetValues(issue, field, columnStateType));
    return cond.op === 'is_set' ? present : !present;
  }

  // is / is_not — set membership. Any other stored operator constrains nothing.
  if (cond.op !== 'is' && cond.op !== 'is_not') return true;
  const issueValues = builtinSetValues(issue, field, columnStateType);
  const overlaps = cond.values.some((cv) => issueValues.includes(cv));
  return cond.op === 'is' ? overlaps : !overlaps;
}

// Returns the issues that satisfy every effective condition in the set. An
// empty or all-empty set returns the input unchanged.
export function applyFilters(
  issues: Issue[],
  filters: FilterSet | null | undefined,
  team: TeamDetail,
): Issue[] {
  if (!isActiveFilterSet(filters)) return issues;
  const columnStateType = new Map(team.states.map((c) => [c.id, c.stateType]));
  const active = filters!.conditions.filter(isEffectiveCondition);
  return issues.filter((t) => active.every((cond) => matchCondition(t, cond, columnStateType)));
}
