import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupByStateType,
  MY_ISSUES_TABS,
  myIssuesFilter,
} from '@/features/my-issues/utils/myIssues';

describe('myIssuesFilter', () => {
  it('maps each tab to its filter', () => {
    assert.deepEqual(myIssuesFilter('assigned'), { assignee: { isMe: { eq: true } } });
    assert.deepEqual(myIssuesFilter('created'), { creator: { isMe: { eq: true } } });
    assert.deepEqual(myIssuesFilter('subscribed'), {
      subscribers: { some: { isMe: { eq: true } } },
    });
  });

  it('makes Activity any issue the viewer is assigned, created or subscribed to', () => {
    assert.deepEqual(myIssuesFilter('activity'), {
      or: [
        { assignee: { isMe: { eq: true } } },
        { creator: { isMe: { eq: true } } },
        { subscribers: { some: { isMe: { eq: true } } } },
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
