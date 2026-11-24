// Converts between the web's filter set (the conditions the filter bar edits) and
// Linear's IssueFilter, which saved views store (CustomView.filterData). The same
// rules are applied to views saved before the change by the database migration
// that introduced filterData (packages/db/drizzle/0021_*.sql); keep the two in step.
//
// A filter set becomes { and: [element, …] } with one element per effective
// condition, in order; an empty set becomes {}. Reading back recognises exactly the
// shapes written here; anything else is dropped.

import { SUBSCRIBER_ME, type FilterCondition, type FilterSet, type FilterValue } from './filters';

export type IssueFilter = Record<string, unknown>;

type Element = Record<string, unknown>;

const DATE_KEYS: Record<string, string> = {
  dueDate: 'dueDate',
  created: 'createdAt',
  updated: 'updatedAt',
};

// createdAt and updatedAt are timestamps, compared from midnight UTC of the given day.
// "After D" means from the next day on (the filter bar excludes D itself), so it is
// stored as `gte` the next day; dueDate is a date, so `gt D` already excludes D.
// "Before D" is `lt D` for both.
const TIMESTAMP_KEYS = new Set(['createdAt', 'updatedAt']);

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

function split(values: FilterValue[]): { ids: FilterValue[]; hasNull: boolean } {
  return {
    ids: values.filter((v) => v !== null && v !== ''),
    hasNull: values.some((v) => v === null),
  };
}

function conditionToElement(c: FilterCondition): Element | null {
  const { field, op } = c;
  const values = c.values ?? [];
  const { ids, hasNull } = split(values);
  const hasIds = ids.length > 0;

  if (field === 'status' || field === 'statusType') {
    const key = field === 'status' ? 'id' : 'type';
    if (op === 'is' && hasIds) return { state: { [key]: { in: ids } } };
    if (op === 'is_not' && hasIds) return { state: { [key]: { nin: ids } } };
    return null;
  }

  if (field === 'assignee' || field === 'delegate' || field === 'cycle') {
    if (op === 'is_set') return { [field]: { null: false } };
    if (op === 'is_not_set') return { [field]: { null: true } };
    if (op === 'is') {
      if (hasIds && hasNull)
        return { or: [{ [field]: { id: { in: ids } } }, { [field]: { null: true } }] };
      if (hasIds) return { [field]: { id: { in: ids } } };
      if (hasNull) return { [field]: { null: true } };
      return null;
    }
    if (op === 'is_not') {
      if (hasIds && hasNull) return { [field]: { id: { nin: ids } } };
      if (hasIds) return { or: [{ [field]: { null: true } }, { [field]: { id: { nin: ids } } }] };
      if (hasNull) return { [field]: { null: false } };
      return null;
    }
    return null;
  }

  if (field === 'priority') {
    if (op === 'is_set') return { priority: { neq: 0 } };
    if (op === 'is_not_set') return { priority: { eq: 0 } };
    if (values.length === 0) return null;
    const nums = values.map((v) => (v === null ? 0 : v));
    if (op === 'is') return { priority: { in: nums } };
    if (op === 'is_not') return { priority: { nin: nums } };
    return null;
  }

  if (field === 'labels') {
    const some = { labels: { some: { id: { in: ids } } } };
    const every = { labels: { every: { id: { nin: ids } } } };
    const none = { labels: { length: { eq: 0 } } };
    const any = { labels: { length: { gt: 0 } } };
    if (op === 'is_set') return any;
    if (op === 'is_not_set') return none;
    if (op === 'is') {
      if (hasIds && hasNull) return { or: [some, none] };
      if (hasIds) return some;
      if (hasNull) return none;
      return null;
    }
    if (op === 'is_not') {
      if (hasIds && hasNull) return { and: [every, any] };
      if (hasIds) return every;
      if (hasNull) return any;
      return null;
    }
    return null;
  }

  if (field === 'subscribers') {
    const me = values.includes(SUBSCRIBER_ME);
    const users = ids.filter((v) => v !== SUBSCRIBER_ME);
    if (op === 'is') {
      const parts: Element[] = [];
      if (me) parts.push({ subscribers: { some: { isMe: { eq: true } } } });
      if (users.length) parts.push({ subscribers: { some: { id: { in: users } } } });
      return parts.length === 2 ? { or: parts } : (parts[0] ?? null);
    }
    if (op === 'is_not') {
      const parts: Element[] = [];
      if (me) parts.push({ subscribers: { every: { isMe: { eq: false } } } });
      if (users.length) parts.push({ subscribers: { every: { id: { nin: users } } } });
      return parts.length === 2 ? { and: parts } : (parts[0] ?? null);
    }
    return null;
  }

  const dateKey = DATE_KEYS[field];
  if (dateKey) {
    if (op === 'is_set') return { [dateKey]: { null: false } };
    if (op === 'is_not_set') return { [dateKey]: { null: true } };
    const value = values[0];
    if (typeof value !== 'string') return null;
    if (op === 'before') return { [dateKey]: { lt: value } };
    if (op === 'after')
      return TIMESTAMP_KEYS.has(dateKey)
        ? { [dateKey]: { gte: shiftDay(value, 1) } }
        : { [dateKey]: { gt: value } };
    return null;
  }

  return null;
}

export function filterSetToIssueFilter(set: FilterSet | null | undefined): IssueFilter {
  const elements = (set?.conditions ?? [])
    .map(conditionToElement)
    .filter((e): e is Element => e !== null);
  return elements.length ? { and: elements } : {};
}

// --- Reading back ----------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const only = (o: Record<string, unknown>): [string, unknown] | null => {
  const keys = Object.keys(o);
  return keys.length === 1 ? [keys[0]!, o[keys[0]!]] : null;
};

// The values of an `in` / `nin` comparator; a single-value `eq` / `neq`, as API and
// MCP clients write it, reads as a list of one.
const ids = (comparator: unknown, op: 'in' | 'nin'): FilterValue[] | null => {
  if (!isObject(comparator)) return null;
  const entry = only(comparator);
  if (!entry) return null;
  if (entry[0] === op && Array.isArray(entry[1])) return entry[1] as FilterValue[];
  if (entry[0] === (op === 'in' ? 'eq' : 'neq') && entry[1] !== undefined)
    return [entry[1] as FilterValue];
  return null;
};

type Partial = Omit<FilterCondition, 'id'>;

const isNullCheck = (v: unknown, expected: boolean) =>
  isObject(v) && only(v)?.[0] === 'null' && v.null === expected;

// An optional reference (assignee, delegate, cycle): by id, or set / not set.
function refElement(field: 'assignee' | 'delegate' | 'cycle', value: unknown): Partial | null {
  if (!isObject(value)) return null;
  if (isNullCheck(value, true)) return { field, op: 'is_not_set', values: [] };
  if (isNullCheck(value, false)) return { field, op: 'is_set', values: [] };
  const entry = only(value);
  if (entry?.[0] !== 'id') return null;
  const inIds = ids(entry[1], 'in');
  if (inIds) return { field, op: 'is', values: inIds };
  const ninIds = ids(entry[1], 'nin');
  if (ninIds) return { field, op: 'is_not', values: [...ninIds, null] };
  return null;
}

function labelsElement(value: unknown): Partial | null {
  if (!isObject(value)) return null;
  const entry = only(value);
  if (!entry) return null;
  const [key, inner] = entry;
  if (key === 'length' && isObject(inner)) {
    if (inner.eq === 0) return { field: 'labels', op: 'is_not_set', values: [] };
    if (inner.gt === 0) return { field: 'labels', op: 'is_set', values: [] };
    return null;
  }
  if ((key === 'some' || key === 'every') && isObject(inner)) {
    const idEntry = only(inner);
    if (idEntry?.[0] !== 'id') return null;
    const list = ids(idEntry[1], key === 'some' ? 'in' : 'nin');
    if (!list) return null;
    return { field: 'labels', op: key === 'some' ? 'is' : 'is_not', values: list };
  }
  return null;
}

// One subscribers element: some subscriber is the viewer / one of these users ("is"),
// or every subscriber is not ("is not").
function subscribersElement(value: unknown): Partial | null {
  if (!isObject(value)) return null;
  const entry = only(value);
  if (!entry || !isObject(entry[1])) return null;
  const [quantifier, inner] = entry as [string, Record<string, unknown>];
  if (quantifier !== 'some' && quantifier !== 'every') return null;
  const op = quantifier === 'some' ? 'is' : 'is_not';
  const field = only(inner);
  if (field?.[0] === 'isMe' && isObject(field[1]) && only(field[1])?.[0] === 'eq') {
    if (field[1].eq === (quantifier === 'some'))
      return { field: 'subscribers', op, values: [SUBSCRIBER_ME] };
    return null;
  }
  if (field?.[0] === 'id') {
    const list = ids(field[1], quantifier === 'some' ? 'in' : 'nin');
    return list ? { field: 'subscribers', op, values: list } : null;
  }
  return null;
}

function elementToCondition(element: unknown): Partial | null {
  if (!isObject(element)) return null;
  const entry = only(element);
  if (!entry) return null;
  const [key, value] = entry;

  // "Me and these users": the two subscribers parts written above, joined.
  if ((key === 'or' || key === 'and') && Array.isArray(value) && value.length === 2) {
    const parts = value.map((v) =>
      isObject(v) && only(v)?.[0] === 'subscribers' ? subscribersElement(v.subscribers) : null,
    );
    const [a, b] = parts;
    const op = key === 'or' ? 'is' : 'is_not';
    if (a && b && a.op === op && b.op === op)
      return { field: 'subscribers', op, values: [...a.values, ...b.values] };
  }

  if (key === 'or' || key === 'and') {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [a, b] = value.map(elementToCondition);
    if (!a || !b || a.field !== b.field) return null;
    if (key === 'or' && a.op === 'is' && b.op === 'is_not_set')
      return { field: a.field, op: 'is', values: [...a.values, null] };
    if (key === 'or' && a.op === 'is_not_set' && b.op === 'is_not')
      return { field: b.field, op: 'is_not', values: b.values.filter((v) => v !== null) };
    if (key === 'and' && a.op === 'is_not' && b.op === 'is_set')
      return { field: a.field, op: 'is_not', values: [...a.values, null] };
    return null;
  }

  if (key === 'state' && isObject(value)) {
    const inner = only(value);
    if (!inner || (inner[0] !== 'id' && inner[0] !== 'type')) return null;
    const field = inner[0] === 'id' ? 'status' : 'statusType';
    const inIds = ids(inner[1], 'in');
    if (inIds) return { field, op: 'is', values: inIds };
    const ninIds = ids(inner[1], 'nin');
    if (ninIds) return { field, op: 'is_not', values: ninIds };
    return null;
  }

  if (key === 'assignee' || key === 'delegate' || key === 'cycle') return refElement(key, value);

  if (key === 'priority' && isObject(value)) {
    const inner = only(value);
    if (!inner) return null;
    if (inner[0] === 'neq' && inner[1] === 0)
      return { field: 'priority', op: 'is_set', values: [] };
    if (inner[0] === 'eq' && inner[1] === 0)
      return { field: 'priority', op: 'is_not_set', values: [] };
    const isValues = ids(value, 'in');
    const notValues = ids(value, 'nin');
    const values = isValues ?? notValues;
    if (values)
      return {
        field: 'priority',
        op: isValues ? 'is' : 'is_not',
        values: values.map((v) => (v === 0 ? null : v)),
      };
    return null;
  }

  if (key === 'labels') return labelsElement(value);

  if (key === 'subscribers') return subscribersElement(value);

  const dateField = Object.entries(DATE_KEYS).find(([, k]) => k === key)?.[0];
  if (dateField && isObject(value)) {
    if (isNullCheck(value, false)) return { field: dateField, op: 'is_set', values: [] };
    if (isNullCheck(value, true)) return { field: dateField, op: 'is_not_set', values: [] };
    const inner = only(value);
    if (inner && typeof inner[1] === 'string') {
      const day = inner[1];
      const timestamp = TIMESTAMP_KEYS.has(key);
      if (inner[0] === 'lt') return { field: dateField, op: 'before', values: [day] };
      if (inner[0] === 'gt' && !timestamp) return { field: dateField, op: 'after', values: [day] };
      if (inner[0] === 'gte' && timestamp)
        return { field: dateField, op: 'after', values: [shiftDay(day, -1)] };
    }
    return null;
  }

  return null;
}

export function issueFilterToFilterSet(filter: unknown): FilterSet {
  if (!isObject(filter) || Object.keys(filter).length === 0) return { conditions: [] };
  const elements =
    Array.isArray(filter.and) && Object.keys(filter).length === 1 ? filter.and : [filter];
  const conditions = elements
    .map(elementToCondition)
    .filter((c): c is Partial => c !== null)
    .map((c, i) => ({ id: `c${i}`, ...c }));
  return { conditions };
}
