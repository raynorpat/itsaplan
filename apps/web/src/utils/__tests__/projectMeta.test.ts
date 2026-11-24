import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { projectDisplayName } from '../projectMeta';
import { buildGroups, cellAssign } from '../team';

// An issue keeps its link to a project in the trash; the project's name then says so.
describe('projectDisplayName', () => {
  it('is the name of an active project', () => {
    assert.equal(
      projectDisplayName({ title: 'Mobile app launch', deleted: false }),
      'Mobile app launch',
    );
  });

  it('marks a deleted project', () => {
    assert.equal(
      projectDisplayName({ title: 'Mobile app launch', deleted: true }),
      'Mobile app launch (deleted)',
    );
  });
});

describe('project groups', () => {
  const team = {
    states: [],
    labels: [],
    assignees: [],
    delegates: [],
    teamCycles: [],
    cycles: { enabled: false },
    issues: [
      { id: 'i1', project: { id: 'p1', title: 'Live', deleted: false } },
      { id: 'i2', project: { id: 'p2', title: 'Gone', deleted: true } },
    ] as unknown as Issue[],
  } as unknown as TeamDetail;

  it('makes a deleted project group no drop target', () => {
    const groups = buildGroups(team, 'project');
    assert.deepEqual(
      groups.map((g) => [g.key, g.name, g.assign, g.deleted ?? false]),
      [
        ['ip2', 'Gone (deleted)', null, true],
        ['ip1', 'Live', { projectId: 'p1' }, false],
        ['i-none', 'No project', { projectId: null }, false],
      ],
    );
  });
});

describe('cellAssign', () => {
  it('is null for a cell in a deleted project group', () => {
    const live = { key: 'ip1', name: 'Live', assign: { projectId: 'p1' } };
    const gone = { key: 'ip2', name: 'Gone', deleted: true, assign: null };
    const todo = { key: 's1', name: 'Todo', assign: { stateId: 's1' } };
    assert.equal(cellAssign(todo, gone), null);
    assert.equal(cellAssign(gone, todo), null);
    assert.deepEqual(cellAssign(todo, live), { stateId: 's1', projectId: 'p1' });
  });
});
