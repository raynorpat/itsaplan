import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { issuesVersion, sortIssues } from '../team';
import { SORT_FIELDS, sortForField } from '../viewTypes';
import { sortMyIssues } from '@/features/my-issues/utils/myIssues';

// The orderings Linear has beyond the original list, with the API's value rules
// (graphql/issue-sort.ts): empty values last in both directions, issues with several
// labels by their lowest name ascending and highest descending, and ties by manual
// position, then newest created, then id.

const issue = (id: string, extra: Partial<Issue> = {}): Issue =>
  ({
    id,
    teamId: 't',
    sequenceNumber: 1,
    identifier: `ENG-${id}`,
    title: id,
    stateId: 's',
    priority: 0,
    estimate: null,
    completedAt: null,
    cycle: null,
    cycleId: null,
    project: null,
    labelIds: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    position: 0,
    ...extra,
  }) as Issue;

const team = {
  states: [{ id: 's', stateType: 'unstarted' }],
  assignees: [],
  labels: [
    { id: 'l-api', name: 'API' },
    { id: 'l-bug', name: 'bug' },
    { id: 'l-ui', name: 'UI' },
  ],
  cycles: { enabled: true },
  teamCycles: [],
  issues: [],
} as unknown as TeamDetail;

const ids = (issues: Issue[]) => issues.map((i) => i.id);

describe('issue orderings', () => {
  it('offers the new orderings, starting in Linear direction', () => {
    const values = SORT_FIELDS.map((f) => f.value);
    for (const f of [
      'estimate',
      'completed',
      'cycle',
      'project',
      'milestone',
      'label',
      'release',
      'linkCount',
      'customerRevenue',
    ])
      assert.ok(values.includes(f as never), f);
    assert.equal(sortForField('completed').dir, 'desc');
    assert.equal(sortForField('linkCount').dir, 'desc');
    assert.equal(sortForField('customerRevenue').dir, 'desc');
    assert.equal(sortForField('estimate').dir, 'asc');
    assert.equal(sortForField('label').dir, 'asc');
  });

  it('orders by estimate with empty estimates last in both directions', () => {
    const list = [issue('a', { estimate: 3 }), issue('b'), issue('c', { estimate: 1 })];
    assert.deepEqual(ids(sortIssues(list, { field: 'estimate', dir: 'asc' }, team)), [
      'c',
      'a',
      'b',
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'estimate', dir: 'desc' }, team)), [
      'a',
      'c',
      'b',
    ]);
  });

  it('orders by completed date, project name, cycle start and milestone target', () => {
    const list = [
      issue('a', {
        completedAt: '2026-11-03T00:00:00Z',
        project: { id: 'p1', title: 'beta', deleted: false },
        cycle: {
          id: 'c2',
          number: 2,
          name: null,
          startsAt: '2026-11-08',
          endsAt: '',
          completedAt: null,
        },
        milestoneTargetDate: '2026-12-01',
      }),
      issue('b', {
        completedAt: '2026-11-05T00:00:00Z',
        project: { id: 'p2', title: 'Alpha', deleted: false },
        cycle: {
          id: 'c1',
          number: 1,
          name: null,
          startsAt: '2026-11-01',
          endsAt: '',
          completedAt: null,
        },
        milestoneTargetDate: '2026-11-20',
      }),
      issue('c'),
    ];
    assert.deepEqual(ids(sortIssues(list, { field: 'completed', dir: 'desc' }, team)), [
      'b',
      'a',
      'c',
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'project', dir: 'asc' }, team)), [
      'b',
      'a',
      'c',
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'cycle', dir: 'asc' }, team)), ['b', 'a', 'c']);
    assert.deepEqual(ids(sortIssues(list, { field: 'milestone', dir: 'asc' }, team)), [
      'b',
      'a',
      'c',
    ]);
  });

  it('orders an issue with two labels by its lowest name ascending and highest descending', () => {
    const list = [
      issue('two', { labelIds: ['l-api', 'l-ui'] }),
      issue('bug', { labelIds: ['l-bug'] }),
      issue('none'),
    ];
    assert.deepEqual(ids(sortIssues(list, { field: 'label', dir: 'asc' }, team)), [
      'two',
      'bug',
      'none',
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'label', dir: 'desc' }, team)), [
      'two',
      'bug',
      'none',
    ]);
    const onlyApi = [issue('api', { labelIds: ['l-api'] }), issue('bug', { labelIds: ['l-bug'] })];
    assert.deepEqual(ids(sortIssues(onlyApi, { field: 'label', dir: 'desc' }, team)), [
      'bug',
      'api',
    ]);
  });

  it('orders release and link count by the ranks the API returned', () => {
    const list = [issue('a'), issue('b'), issue('c')];
    const ranks = new Map([
      ['c', 0],
      ['a', 1],
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'release', dir: 'desc' }, team, { ranks })), [
      'c',
      'a',
      'b',
    ]);
    assert.deepEqual(ids(sortIssues(list, { field: 'linkCount', dir: 'asc' }, team, { ranks })), [
      'c',
      'a',
      'b',
    ]);
  });

  it('orders by the largest asking customer revenue only while Customers is on', () => {
    const summary = (revenue: Record<string, number>) => ({
      count: 1,
      requesterIds: [],
      importantRequesterIds: [],
      customerKeys: Object.keys(revenue).map((k) => `c:${k}`),
      customerRevenue: revenue,
    });
    const list = [
      issue('small', { requests: summary({ x: 100 }) }),
      issue('big', { requests: summary({ y: 50, z: 900 }) }),
      issue('none'),
    ];
    assert.deepEqual(
      ids(sortIssues(list, { field: 'customerRevenue', dir: 'desc' }, team, { customersOn: true })),
      ['big', 'small', 'none'],
    );
    // Off: every issue is empty, so the tie-break decides (equal position and created
    // date: id descending).
    assert.deepEqual(ids(sortIssues(list, { field: 'customerRevenue', dir: 'desc' }, team)), [
      'small',
      'none',
      'big',
    ]);
  });

  it('counts customers for the requests ordering while Customers is on', () => {
    const list = [
      issue('a', {
        requests: {
          count: 2,
          requesterIds: ['p1', 'p2'],
          importantRequesterIds: [],
          customerKeys: ['c:acme'],
        },
      }),
      issue('b', {
        requests: {
          count: 1,
          requesterIds: ['p3'],
          importantRequesterIds: [],
          customerKeys: ['c:x', 'c:y'],
        },
      }),
    ];
    assert.deepEqual(ids(sortIssues(list, { field: 'requests', dir: 'desc' }, team)), ['a', 'b']);
    assert.deepEqual(
      ids(sortIssues(list, { field: 'requests', dir: 'desc' }, team, { customersOn: true })),
      ['b', 'a'],
    );
  });

  it('orders text by code point without regard to case, as the API does', () => {
    const issues = ['b', '_x', 'C', 'Issue 10', 'Issue 9'].map((title, i) =>
      issue(`i${i}`, { title, position: i }),
    );
    const byTitle = sortIssues(issues, { field: 'title', dir: 'asc' }, team).map((i) => i.title);
    assert.deepEqual(byTitle, ['_x', 'b', 'C', 'Issue 10', 'Issue 9']);
  });

  it('changes the issues version when an issue is added or changed', () => {
    const a = issue('a', { updatedAt: '2026-11-01T00:00:00Z' });
    const b = issue('b', { updatedAt: '2026-11-02T00:00:00Z' });
    const before = issuesVersion([a, b]);
    assert.equal(issuesVersion([b, a]), before);
    assert.notEqual(issuesVersion([a, b, issue('c')]), before);
    assert.notEqual(issuesVersion([a, { ...b, updatedAt: '2026-11-03T00:00:00Z' }]), before);
  });

  it('breaks ties by manual position, then newest created, then id', () => {
    const list = [
      issue('a', { estimate: 1, position: 2 }),
      issue('b', { estimate: 1, position: 1, createdAt: '2026-11-01T00:00:00Z' }),
      issue('c', { estimate: 1, position: 1, createdAt: '2026-11-02T00:00:00Z' }),
      issue('d', { estimate: 1, position: 1, createdAt: '2026-11-02T00:00:00Z' }),
    ];
    assert.deepEqual(ids(sortIssues(list, { field: 'estimate', dir: 'asc' }, team)), [
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  it('orders My issues by estimate, cycle, project and label', () => {
    const my = (id: string, extra: Record<string, unknown>) => ({
      id,
      title: id,
      identifier: `ENG-${id}`,
      priority: 0,
      dueDate: null,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
      completedAt: null,
      estimate: null,
      state: { type: 'unstarted' },
      assignee: null,
      project: null,
      cycle: null,
      labels: [] as { name: string }[],
      ...extra,
    });
    const list = [
      my('a', { estimate: 5, project: { name: 'Zeta' }, labels: [{ name: 'ui' }] }),
      my('b', { estimate: 2, project: { name: 'alpha' }, labels: [{ name: 'API' }] }),
    ];
    const order = (field: string, dir: 'asc' | 'desc') =>
      sortMyIssues(list, { field: field as never, dir }).map((i) => i.id);
    assert.deepEqual(order('estimate', 'asc'), ['b', 'a']);
    assert.deepEqual(order('project', 'asc'), ['b', 'a']);
    assert.deepEqual(order('label', 'asc'), ['b', 'a']);
  });
});
