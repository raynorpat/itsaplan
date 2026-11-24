import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectDisplayName } from '../projectMeta';

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
