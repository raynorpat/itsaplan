import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultIncludeCompleted,
  groupByStateType,
  MY_ISSUES_TABS,
  myIssueRow,
  myIssuesFilter,
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

  it('shows Created and Activity without completed issues at first', () => {
    assert.deepEqual(
      MY_ISSUES_TABS.map((t) => defaultIncludeCompleted(t.id)),
      [true, false, true, false],
    );
  });

  it('lists the four tabs in Linear order', () => {
    assert.deepEqual(
      MY_ISSUES_TABS.map((t) => t.id),
      ['assigned', 'created', 'subscribed', 'activity'],
    );
  });
});

describe('groupByStateType', () => {
  const issue = (id: string, type: string) => ({ id, state: { type } });

  it('groups by status type in workflow order and drops empty groups', () => {
    const groups = groupByStateType([
      issue('a', 'completed'),
      issue('b', 'started'),
      issue('c', 'backlog'),
      issue('d', 'started'),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.type, g.issues.map((i) => i.id)]),
      [
        ['started', ['b', 'd']],
        ['backlog', ['c']],
        ['completed', ['a']],
      ],
    );
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
