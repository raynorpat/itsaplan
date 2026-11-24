import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupMyIssues,
  MY_ISSUES_CAP,
  MY_ISSUES_TABS,
  myIssuesLoadMode,
  shouldLoadMore,
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
    extra: { priority?: number; project?: { id: string; name: string } | null } = {},
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

  it('groups by project, by name, issues without a project last', () => {
    const groups = groupMyIssues(
      [
        issue('a', 'started'),
        issue('b', 'started', { project: { id: 'w', name: 'Web' } }),
        issue('c', 'started', { project: { id: 'm', name: 'Mobile' } }),
      ],
      'project',
    );
    assert.deepEqual(keys(groups), [
      ['project:m', ['c']],
      ['project:w', ['b']],
      ['project:', ['a']],
    ]);
    assert.equal(groups[0]!.name, 'Mobile');
    assert.equal(groups[2]!.name, 'No project');
  });

  it('keeps two projects with the same name apart', () => {
    const groups = groupMyIssues(
      [
        issue('a', 'started', { project: { id: 'p1', name: 'Launch' } }),
        issue('b', 'started', { project: { id: 'p2', name: 'Launch' } }),
      ],
      'project',
    );
    assert.deepEqual(keys(groups), [
      ['project:p1', ['a']],
      ['project:p2', ['b']],
    ]);
  });

  it('marks priority groups with their priority, for the priority icon', () => {
    const groups = groupMyIssues([issue('a', 'started', { priority: 2 })], 'priority');
    assert.equal(groups[0]!.priority, 2);
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
    project: { id: 'm', name: 'Mobile' },
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

  it('marks a project in the trash as deleted', () => {
    const row = myIssueRow({
      ...base,
      project: { id: 'm', name: 'Mobile', archivedAt: '2026-11-24T00:00:00Z' },
    });
    assert.equal(row.project, 'Mobile (deleted)');
  });

  it('never marks a finished issue overdue', () => {
    assert.deepEqual(myIssueRow(base).dueDate, { date: '2020-01-01', overdue: false });
    const open = myIssueRow({ ...base, state: { ...base.state, type: 'started' } });
    assert.equal(open.dueDate?.overdue, true);
  });
});

describe('loading My issues', () => {
  const updated = { field: 'updated' as const, dir: 'desc' as const };

  it('pages by the time of the last change, the order the server returns', () => {
    assert.equal(myIssuesLoadMode('assigned', { sort: updated, group: 'none' }), 'paged');
    assert.equal(myIssuesLoadMode('activity', { sort: updated, group: 'priority' }), 'paged');
  });

  it('loads the whole set for an ordering or grouping the server cannot do', () => {
    assert.equal(
      myIssuesLoadMode('assigned', { sort: { field: 'priority', dir: 'asc' }, group: 'none' }),
      'all',
    );
    assert.equal(myIssuesLoadMode('assigned', { sort: updated, group: 'status' }), 'all');
  });

  const base = { hasNextPage: true, fetching: false, loaded: 50, visible: 10 };

  it('keeps loading the whole set up to the cap', () => {
    assert.equal(shouldLoadMore({ ...base, mode: 'all' }), true);
    assert.equal(shouldLoadMore({ ...base, mode: 'all', loaded: MY_ISSUES_CAP }), false);
    assert.equal(shouldLoadMore({ ...base, mode: 'all', fetching: true }), false);
    assert.equal(shouldLoadMore({ ...base, mode: 'all', hasNextPage: false }), false);
  });

  it('pages on request, but loads on while nothing loaded is shown', () => {
    assert.equal(shouldLoadMore({ ...base, mode: 'paged' }), false);
    assert.equal(shouldLoadMore({ ...base, mode: 'paged', visible: 0 }), true);
    assert.equal(
      shouldLoadMore({ ...base, mode: 'paged', visible: 0, loaded: MY_ISSUES_CAP }),
      false,
    );
  });
});
