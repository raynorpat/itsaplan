import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupMyIssues,
  MY_ISSUES_TABS,
  myIssueRow,
  myIssuesFilter,
  myIssuesGrouping,
  myIssuesSort,
  sortMyIssues,
} from '@/features/my-issues/utils/myIssues';

describe('myIssuesFilter', () => {
  it('maps each tab to its filter', () => {
    assert.deepEqual(myIssuesFilter('assigned', true), { assignee: { isMe: { eq: true } } });
    assert.deepEqual(myIssuesFilter('created', true), { creator: { isMe: { eq: true } } });
    assert.deepEqual(myIssuesFilter('subscribed', true), {
      subscribers: { some: { isMe: { eq: true } } },
    });
  });

  it('makes Activity any issue the viewer is assigned, created or subscribed to', () => {
    assert.deepEqual(myIssuesFilter('activity', true), {
      or: [
        { assignee: { isMe: { eq: true } } },
        { creator: { isMe: { eq: true } } },
        { subscribers: { some: { isMe: { eq: true } } } },
      ],
    });
  });

  it('leaves completed and canceled issues out unless asked for', () => {
    assert.deepEqual(myIssuesFilter('created', false), {
      and: [
        { creator: { isMe: { eq: true } } },
        { state: { type: { nin: ['completed', 'canceled'] } } },
      ],
    });
  });

  it('lists the four tabs in Linear order', () => {
    assert.deepEqual(
      MY_ISSUES_TABS.map((t) => t.id),
      ['assigned', 'created', 'subscribed', 'activity'],
    );
  });
});

describe('groupMyIssues', () => {
  const issue = (
    id: string,
    type: string,
    extra: { priority?: number; project?: { name: string } | null } = {},
  ) => ({
    id,
    state: { type, color: '#000' },
    priority: extra.priority ?? 0,
    project: extra.project ?? null,
  });
  const keys = (groups: { key: string; issues: { id: string }[] }[]) =>
    groups.map((g) => [g.key, g.issues.map((i) => i.id)]);

  it('groups by status type in workflow order across teams and drops empty groups', () => {
    const groups = groupMyIssues(
      [
        issue('a', 'completed'),
        issue('b', 'started'),
        issue('c', 'backlog'),
        issue('d', 'started'),
      ],
      'status',
    );
    assert.deepEqual(keys(groups), [
      ['started', ['b', 'd']],
      ['backlog', ['c']],
      ['completed', ['a']],
    ]);
    assert.equal(groups[0]!.name, 'In Progress');
  });

  it('groups by priority, most urgent first and no priority last', () => {
    const groups = groupMyIssues(
      [
        issue('a', 'started', { priority: 0 }),
        issue('b', 'started', { priority: 3 }),
        issue('c', 'started', { priority: 1 }),
      ],
      'priority',
    );
    assert.deepEqual(keys(groups), [
      ['p1', ['c']],
      ['p3', ['b']],
      ['p0', ['a']],
    ]);
    assert.equal(groups[2]!.name, 'No priority');
  });

  it('groups by project name, issues without a project last', () => {
    const groups = groupMyIssues(
      [
        issue('a', 'started'),
        issue('b', 'started', { project: { name: 'Web' } }),
        issue('c', 'started', { project: { name: 'Mobile' } }),
      ],
      'project',
    );
    assert.deepEqual(keys(groups), [
      ['project:Mobile', ['c']],
      ['project:Web', ['b']],
      ['project:', ['a']],
    ]);
    assert.equal(groups[2]!.name, 'No project');
  });

  it('puts every issue in one group without grouping', () => {
    assert.deepEqual(keys(groupMyIssues([issue('a', 'started'), issue('b', 'done')], 'none')), [
      ['all', ['a', 'b']],
    ]);
  });
});

describe('myIssuesGrouping', () => {
  it('keeps the groupings My issues offers and falls back to status', () => {
    assert.equal(myIssuesGrouping('priority'), 'priority');
    assert.equal(myIssuesGrouping('none'), 'none');
    assert.equal(myIssuesGrouping('assignee'), 'status');
    assert.equal(myIssuesGrouping('cycle'), 'status');
  });
});

describe('sortMyIssues', () => {
  const issue = (
    id: string,
    fields: Partial<{
      title: string;
      identifier: string;
      priority: number;
      dueDate: string | null;
      updatedAt: string;
      createdAt: string;
      state: { type: string };
      assignee: { name: string } | null;
    }>,
  ) => ({
    id,
    title: 'x',
    identifier: 'ENG-1',
    priority: 0,
    dueDate: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    state: { type: 'started' },
    assignee: null,
    ...fields,
  });
  const ids = (list: { id: string }[]) => list.map((i) => i.id);

  it('reads the default (manual) order as the newest change first', () => {
    assert.deepEqual(myIssuesSort({ field: 'manual', dir: 'asc' }), {
      field: 'updated',
      dir: 'desc',
    });
    assert.deepEqual(myIssuesSort({ field: 'priority', dir: 'asc' }), {
      field: 'priority',
      dir: 'asc',
    });
  });

  it('orders by priority with no priority last', () => {
    const list = [
      issue('none', { priority: 0 }),
      issue('low', { priority: 4 }),
      issue('urgent', { priority: 1 }),
    ];
    assert.deepEqual(ids(sortMyIssues(list, { field: 'priority', dir: 'asc' })), [
      'urgent',
      'low',
      'none',
    ]);
  });

  it('keeps missing due dates last in both directions', () => {
    const list = [
      issue('none', {}),
      issue('late', { dueDate: '2026-12-01' }),
      issue('soon', { dueDate: '2026-11-01' }),
    ];
    assert.deepEqual(ids(sortMyIssues(list, { field: 'dueDate', dir: 'asc' })), [
      'soon',
      'late',
      'none',
    ]);
    assert.deepEqual(ids(sortMyIssues(list, { field: 'dueDate', dir: 'desc' })), [
      'late',
      'soon',
      'none',
    ]);
  });

  it('orders by status type in workflow order and by identifier across teams', () => {
    const list = [
      issue('done', { state: { type: 'completed' } }),
      issue('todo', { state: { type: 'unstarted' } }),
      issue('doing', { state: { type: 'started' } }),
    ];
    assert.deepEqual(ids(sortMyIssues(list, { field: 'status', dir: 'asc' })), [
      'doing',
      'todo',
      'done',
    ]);
    const byId = [
      issue('e10', { identifier: 'ENG-10' }),
      issue('d2', { identifier: 'DES-2' }),
      issue('e9', { identifier: 'ENG-9' }),
    ];
    assert.deepEqual(ids(sortMyIssues(byId, { field: 'identifier', dir: 'asc' })), [
      'd2',
      'e9',
      'e10',
    ]);
  });

  it('orders by the newest change first for the default order', () => {
    const list = [
      issue('old', { updatedAt: '2026-01-01T00:00:00Z' }),
      issue('new', { updatedAt: '2026-03-01T00:00:00Z' }),
    ];
    assert.deepEqual(ids(sortMyIssues(list, { field: 'manual', dir: 'asc' })), ['new', 'old']);
  });
});

describe('myIssueRow', () => {
  const base = {
    id: 'i1',
    identifier: 'ENG-14',
    number: 14,
    title: 'Add tables',
    priority: 2,
    createdAt: '2026-11-20T00:00:00Z',
    updatedAt: '2026-11-24T00:00:00Z',
    completedAt: null,
    canceledAt: null,
    parentId: null,
    teamKey: 'ENG',
    state: { name: 'Done', type: 'completed', color: '#0f0' },
    assignee: { name: 'Pat', avatarUrl: null },
    delegate: null,
    labels: [{ id: 'l1', name: 'Bug', color: '#f00' }],
    project: { name: 'Mobile' },
    cycle: { number: 3, name: null },
    dueDate: '2020-01-01',
  };

  it('fills the shared list row, with the team in the identifier', () => {
    const row = myIssueRow(base);
    assert.equal(row.identifier, 'ENG-14');
    assert.deepEqual(row.state, { type: 'completed', color: '#0f0', name: 'Done' });
    assert.deepEqual(row.labels, [{ id: 'l1', name: 'Bug', color: '#f00' }]);
    assert.equal(row.project, 'Mobile');
    assert.equal(row.cycle, 'Cycle 3');
    assert.deepEqual(row.assignee, { name: 'Pat', image: null });
  });

  it('never marks a finished issue overdue', () => {
    assert.deepEqual(myIssueRow(base).dueDate, { date: '2020-01-01', overdue: false });
    const open = myIssueRow({ ...base, state: { ...base.state, type: 'started' } });
    assert.equal(open.dueDate?.overdue, true);
  });
});
