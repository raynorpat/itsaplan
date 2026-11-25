import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupIssuesByState } from '../releaseIssues';

const issue = (id: string, type: string, name = type) => ({
  id,
  identifier: id,
  title: id,
  teamKey: 'ENG',
  number: 1,
  state: { name, type, color: '#000000' },
});

describe('groupIssuesByState', () => {
  it('groups by state type in workflow order and leaves out empty groups', () => {
    const groups = groupIssuesByState([
      issue('a', 'completed', 'Done'),
      issue('b', 'started', 'In Progress'),
      issue('c', 'backlog'),
      issue('d', 'completed', 'Done'),
      issue('e', 'canceled'),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.type, g.label, g.issues.map((i) => i.id)]),
      [
        ['backlog', 'Backlog', ['c']],
        ['started', 'In progress', ['b']],
        ['completed', 'Done', ['a', 'd']],
        ['canceled', 'Canceled', ['e']],
      ],
    );
  });
});
