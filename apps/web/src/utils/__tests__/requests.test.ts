import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { applyFilters, type FilterSet } from '../filters';
import { buildFieldSpecs } from '../filterFields';
import { listRowProperties } from '../list';
import {
  importantRequesterCount,
  requesterCount,
  requestsBadgeLabel,
  requestOptions,
  summarizeNeeds,
  withRequests,
} from '../requests';
import { sortIssues } from '../team';
import { filterSetToIssueFilter, issueFilterToFilterSet } from '../viewFilters';
import { DISPLAY_PROPERTIES } from '../viewSettings';
import { SORT_FIELDS } from '../viewTypes';

// Requests (feedback) on issue lists: per-issue summaries from the team's feedback,
// the Requests display property, filter and ordering.

const issue = (id: string, extra: Partial<Issue> = {}): Issue =>
  ({
    id,
    teamId: 't',
    sequenceNumber: Number(id.slice(1)) || 1,
    identifier: `ENG-${id}`,
    title: id,
    stateId: 's',
    priority: 0,
    labelIds: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    position: 0,
    ...extra,
  }) as Issue;

const team = {
  states: [{ id: 's', stateType: 'unstarted' }],
  assignees: [],
  cycles: { enabled: false },
  issues: [],
} as unknown as TeamDetail;

const set = (conditions: Omit<FilterSet['conditions'][number], 'id'>[]): FilterSet => ({
  conditions: conditions.map((c, i) => ({ id: `c${i}`, ...c })),
});

describe('request summaries', () => {
  const summaries = summarizeNeeds([
    { issueId: 'a', priority: 0, requesterId: 'jane' },
    { issueId: 'a', priority: 1, requesterId: 'jane' },
    { issueId: 'a', priority: 0, requesterId: 'sam' },
    { issueId: 'a', priority: 0, requesterId: null },
    { issueId: 'b', priority: 0, requesterId: 'sam' },
  ]);

  it('counts items, distinct people and people with important feedback', () => {
    const a = summaries.get('a')!;
    assert.equal(a.count, 4);
    assert.deepEqual([...a.requesterIds].sort(), ['jane', 'sam']);
    assert.deepEqual(a.importantRequesterIds, ['jane']);
    assert.equal(summaries.get('b')!.count, 1);
    assert.equal(summaries.has('c'), false);
  });

  it('attaches summaries to issues, an issue without feedback getting none', () => {
    const [a, c] = withRequests([issue('a'), issue('c')], summaries);
    assert.equal(requesterCount(a!), 2);
    assert.equal(importantRequesterCount(a!), 1);
    assert.equal(requesterCount(c!), 0);
    assert.equal(importantRequesterCount(c!), 0);
  });

  it('leaves the issues untouched without summaries', () => {
    const issues = [issue('a')];
    assert.equal(withRequests(issues, undefined), issues);
  });
});

describe('requests on lists', () => {
  it('offers Requests as a display property shown first on the right of a row', () => {
    assert.ok(DISPLAY_PROPERTIES.some((p) => p.value === 'requests' && p.label === 'Requests'));
    assert.deepEqual(listRowProperties(['assignee', 'requests', 'labels'], true).trailing, [
      'requests',
      'labels',
      'assignee',
    ]);
  });

  it('orders by number of people asking', () => {
    assert.ok(SORT_FIELDS.some((f) => f.value === 'requests'));
    const summaries = summarizeNeeds([
      { issueId: 'b', priority: 0, requesterId: 'x' },
      { issueId: 'c', priority: 0, requesterId: 'x' },
      { issueId: 'c', priority: 0, requesterId: 'y' },
    ]);
    const issues = withRequests([issue('a'), issue('b'), issue('c')], summaries);
    const desc = sortIssues(issues, { field: 'requests', dir: 'desc' }, team).map((i) => i.id);
    assert.deepEqual(desc, ['c', 'b', 'a']);
    const asc = sortIssues(issues, { field: 'requests', dir: 'asc' }, team).map((i) => i.id);
    assert.deepEqual(asc, ['a', 'b', 'c']);
  });

  it('filters on any or important requests in the browser', () => {
    const summaries = summarizeNeeds([
      { issueId: 'b', priority: 0, requesterId: 'x' },
      { issueId: 'c', priority: 1, requesterId: 'y' },
    ]);
    const issues = withRequests([issue('a'), issue('b'), issue('c')], summaries);
    const ids = (s: FilterSet) => applyFilters(issues, s, team).map((i) => i.id);
    assert.deepEqual(ids(set([{ field: 'requests', op: 'is', values: ['any'] }])), ['b', 'c']);
    assert.deepEqual(ids(set([{ field: 'requests', op: 'is', values: ['important'] }])), ['c']);
    assert.deepEqual(ids(set([{ field: 'requests', op: 'is_not', values: ['any'] }])), ['a']);
    assert.deepEqual(ids(set([{ field: 'requests', op: 'is_not', values: ['important'] }])), [
      'a',
      'b',
    ]);
  });

  it("converts the requests filter to Linear's IssueFilter and back", () => {
    const cases: [Omit<FilterSet['conditions'][number], 'id'>, Record<string, unknown>][] = [
      [{ field: 'requests', op: 'is', values: ['any'] }, { customerCount: { gt: 0 } }],
      [
        { field: 'requests', op: 'is', values: ['important'] },
        { customerImportantCount: { gt: 0 } },
      ],
      [{ field: 'requests', op: 'is_not', values: ['any'] }, { customerCount: { eq: 0 } }],
      [
        { field: 'requests', op: 'is_not', values: ['important'] },
        { customerImportantCount: { eq: 0 } },
      ],
    ];
    for (const [condition, element] of cases) {
      const filter = filterSetToIssueFilter(set([condition]));
      assert.deepEqual(filter, { and: [element] });
      assert.deepEqual(issueFilterToFilterSet(filter).conditions[0], { id: 'c0', ...condition });
    }
    // "Any or important" is the same as "any".
    assert.deepEqual(
      filterSetToIssueFilter(set([{ field: 'requests', op: 'is', values: ['any', 'important'] }])),
      { and: [{ customerCount: { gt: 0 } }] },
    );
  });

  it('describes the Requests badge for screen readers', () => {
    assert.equal(requestsBadgeLabel(1, 0), '1 person asked');
    assert.equal(requestsBadgeLabel(3, 1), '3 people asked, 1 marked it important');
    assert.equal(requestsBadgeLabel(2, 2), '2 people asked, 2 marked it important');
  });

  it('offers the Requests options only to those who read feedback', () => {
    const options = [{ value: 'labels' }, { value: 'requests' }];
    assert.deepEqual(requestOptions(options, true), options);
    assert.deepEqual(requestOptions(options, false), [{ value: 'labels' }]);
  });

  it('offers the Requests filter to members, not guests', () => {
    const scaffold = (workspaceRole: string) =>
      ({
        ...team,
        labels: [],
        viewer: { role: 'member', workspaceRole, canManage: false },
      }) as unknown as TeamDetail;
    const fields = (role: string) => buildFieldSpecs(scaffold(role)).map((s) => s.field);
    assert.ok(fields('member').includes('requests'));
    assert.ok(!fields('guest').includes('requests'));
  });
});
