import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilterSet } from '../filters';
import { filterSetToIssueFilter, issueFilterToFilterSet } from '../viewFilters';

// The web's filter set and Linear's IssueFilter (saved views' filterData): the
// shapes written, a round trip back to the same conditions, and agreement with the
// database migration that converted older views (its outputs for the same inputs).

const set = (conditions: Omit<FilterSet['conditions'][number], 'id'>[]): FilterSet => ({
  conditions: conditions.map((c, i) => ({ id: `c${i}`, ...c })),
});

describe('view filters', () => {
  it('writes the same IssueFilter as the migration', () => {
    const filter = filterSetToIssueFilter(
      set([
        { field: 'status', op: 'is', values: ['a', 'b'] },
        { field: 'assignee', op: 'is', values: ['u1', null] },
        { field: 'assignee', op: 'is_not', values: ['u1'] },
        { field: 'priority', op: 'is', values: [1, null] },
        { field: 'labels', op: 'is_not', values: ['l1', null] },
        { field: 'created', op: 'after', values: ['2026-11-01'] },
        { field: 'dueDate', op: 'is_set', values: [] },
        { field: 'labels', op: 'is', values: [] },
        { field: 'type', op: 'is', values: ['x'] },
      ]),
    );
    // Outputs of the migration's view_condition() for the same conditions.
    assert.deepEqual(filter, {
      and: [
        { state: { id: { in: ['a', 'b'] } } },
        { or: [{ assignee: { id: { in: ['u1'] } } }, { assignee: { null: true } }] },
        { or: [{ assignee: { null: true } }, { assignee: { id: { nin: ['u1'] } } }] },
        { priority: { in: [1, 0] } },
        {
          and: [{ labels: { every: { id: { nin: ['l1'] } } } }, { labels: { length: { gt: 0 } } }],
        },
        { createdAt: { gte: '2026-11-02' } },
        { dueDate: { null: false } },
      ],
    });
  });

  it('reads back the conditions it wrote', () => {
    const original = set([
      { field: 'status', op: 'is_not', values: ['a'] },
      { field: 'statusType', op: 'is', values: ['started'] },
      { field: 'assignee', op: 'is', values: ['u1', null] },
      { field: 'assignee', op: 'is_not', values: ['u1'] },
      { field: 'delegate', op: 'is_not', values: ['d1', null] },
      { field: 'priority', op: 'is', values: [1, null] },
      { field: 'priority', op: 'is_not_set', values: [] },
      { field: 'labels', op: 'is', values: ['l1', null] },
      { field: 'labels', op: 'is_not', values: ['l1', null] },
      { field: 'labels', op: 'is_not', values: ['l2'] },
      { field: 'labels', op: 'is_set', values: [] },
      { field: 'dueDate', op: 'before', values: ['2026-12-01'] },
      { field: 'dueDate', op: 'after', values: ['2026-12-01'] },
      { field: 'updated', op: 'after', values: ['2026-11-30'] },
      { field: 'updated', op: 'is_not_set', values: [] },
    ]);
    assert.deepEqual(issueFilterToFilterSet(filterSetToIssueFilter(original)), original);
  });

  it('excludes the given day from "after" for every date field', () => {
    assert.deepEqual(
      filterSetToIssueFilter(set([{ field: 'updated', op: 'after', values: ['2026-11-30'] }])),
      { and: [{ updatedAt: { gte: '2026-12-01' } }] },
    );
    assert.deepEqual(
      filterSetToIssueFilter(set([{ field: 'dueDate', op: 'after', values: ['2026-11-30'] }])),
      { and: [{ dueDate: { gt: '2026-11-30' } }] },
    );
    assert.deepEqual(
      filterSetToIssueFilter(set([{ field: 'created', op: 'before', values: [] }])),
      {},
    );
  });

  it('writes an empty filter for an empty or ineffective set', () => {
    assert.deepEqual(filterSetToIssueFilter({ conditions: [] }), {});
    assert.deepEqual(filterSetToIssueFilter(set([{ field: 'status', op: 'is', values: [] }])), {});
    assert.deepEqual(issueFilterToFilterSet({}), { conditions: [] });
  });

  it('drops shapes it did not write', () => {
    assert.deepEqual(issueFilterToFilterSet({ and: [{ title: { contains: 'x' } }] }), {
      conditions: [],
    });
  });

  it('round-trips a subscribers condition', () => {
    const conditions = set([
      { field: 'subscribers', op: 'is', values: ['me', 'u2'] },
      { field: 'subscribers', op: 'is_not', values: ['u3'] },
    ]);
    const filter = filterSetToIssueFilter(conditions);
    assert.deepEqual(filter, {
      and: [
        {
          or: [
            { subscribers: { some: { isMe: { eq: true } } } },
            { subscribers: { some: { id: { in: ['u2'] } } } },
          ],
        },
        { subscribers: { every: { id: { nin: ['u3'] } } } },
      ],
    });
    const back = issueFilterToFilterSet(filter).conditions.map(({ field, op, values }) => ({
      field,
      op,
      values,
    }));
    assert.deepEqual(back, [
      { field: 'subscribers', op: 'is', values: ['me', 'u2'] },
      { field: 'subscribers', op: 'is_not', values: ['u3'] },
    ]);
  });
});

describe('cycle condition', () => {
  it('round-trips through Linear IssueFilter', () => {
    const set = {
      conditions: [
        { id: 'a', field: 'cycle', op: 'is' as const, values: ['c1', null] },
        { id: 'b', field: 'cycle', op: 'is_not_set' as const, values: [] },
      ],
    };
    const filter = filterSetToIssueFilter(set);
    assert.deepEqual(filter, {
      and: [
        { or: [{ cycle: { id: { in: ['c1'] } } }, { cycle: { null: true } }] },
        { cycle: { null: true } },
      ],
    });
    assert.deepEqual(
      issueFilterToFilterSet(filter).conditions.map(({ field, op, values }) => ({
        field,
        op,
        values,
      })),
      [
        { field: 'cycle', op: 'is', values: ['c1', null] },
        { field: 'cycle', op: 'is_not_set', values: [] },
      ],
    );
  });
});

// Filters written by API and MCP clients use single-value comparators.
describe('single-value comparators', () => {
  const read = (filter: unknown) =>
    issueFilterToFilterSet(filter).conditions.map(({ field, op, values }) => ({
      field,
      op,
      values,
    }));

  it('reads a priority eq / neq as is / is not', () => {
    assert.deepEqual(read({ priority: { eq: 1 } }), [{ field: 'priority', op: 'is', values: [1] }]);
    assert.deepEqual(read({ priority: { neq: 2 } }), [
      { field: 'priority', op: 'is_not', values: [2] },
    ]);
  });

  it('reads a state id eq / neq as is / is not', () => {
    assert.deepEqual(read({ state: { id: { eq: 's1' } } }), [
      { field: 'status', op: 'is', values: ['s1'] },
    ]);
    assert.deepEqual(read({ state: { type: { neq: 'completed' } } }), [
      { field: 'statusType', op: 'is_not', values: ['completed'] },
    ]);
  });
});
