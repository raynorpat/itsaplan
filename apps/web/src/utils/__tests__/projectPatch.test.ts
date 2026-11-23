import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patchProject } from '../projectPatch';

// The optimistic project after a change, so a second pick in an open picker builds on
// the first before the server answers.

const project = {
  id: 'p1',
  name: 'P',
  priority: 0,
  leadUserId: null as string | null,
  labelIds: ['l1'],
  members: [
    { id: 'a', name: 'Ann', image: null },
    { id: 'b', name: 'Ben', image: null },
  ],
};

describe('patchProject', () => {
  it('applies the changed fields and keeps the rest', () => {
    const next = patchProject(project, { priority: 2, leadUserId: 'a', labelIds: ['l1', 'l2'] });
    assert.equal(next.priority, 2);
    assert.equal(next.leadUserId, 'a');
    assert.deepEqual(next.labelIds, ['l1', 'l2']);
    assert.equal(next.name, 'P');
    assert.deepEqual(next.members, project.members);
  });

  it('sets the members from the given people, in the order of memberIds', () => {
    const cara = { id: 'c', name: 'Cara', image: null };
    const next = patchProject(project, { memberIds: ['b', 'c'] }, [cara]);
    assert.deepEqual(
      next.members.map((m) => m.name),
      ['Ben', 'Cara'],
    );
  });

  it('two picks in a row keep both', () => {
    const cara = { id: 'c', name: 'Cara', image: null };
    const first = patchProject(project, { memberIds: ['a', 'b', 'c'] }, [cara]);
    const second = patchProject(first, {
      memberIds: first.members.filter((m) => m.id !== 'a').map((m) => m.id),
    });
    assert.deepEqual(
      second.members.map((m) => m.id),
      ['b', 'c'],
    );
  });

  it('leaves out a member id it has no person for', () => {
    const next = patchProject(project, { memberIds: ['a', 'zz'] });
    assert.deepEqual(
      next.members.map((m) => m.id),
      ['a'],
    );
  });
});
