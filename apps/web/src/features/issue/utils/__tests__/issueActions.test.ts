import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { issueMenuItems } from '../issueActions';

// issueMenuItems: the entries of the issue's ⋯ menu, hiding what the API would refuse.
describe('issueMenuItems', () => {
  it('lists copy, set parent, archive and delete for an editor who may delete', () => {
    assert.deepEqual(issueMenuItems({ canEdit: true, canDelete: true, archived: false }), [
      'copyLink',
      'copyPrompt',
      'setParent',
      'archive',
      'delete',
    ]);
  });

  it('offers restore instead of archive for an archived issue', () => {
    const items = issueMenuItems({ canEdit: true, canDelete: true, archived: true });
    assert.ok(items.includes('restore'));
    assert.ok(!items.includes('archive'));
  });

  it('lists only the copy entries for a reader', () => {
    assert.deepEqual(issueMenuItems({ canEdit: false, canDelete: false, archived: false }), [
      'copyLink',
      'copyPrompt',
    ]);
  });
});

describe('issueMenuItems parent entries', () => {
  const base = { canDelete: false, archived: false };

  it('offers both to an editor of a sub-issue', () => {
    const items = issueMenuItems({ ...base, canEdit: true, hasParent: true });
    assert.ok(items.includes('setParent'));
    assert.ok(items.includes('removeParent'));
  });

  it('offers neither to a reader', () => {
    const items = issueMenuItems({ ...base, canEdit: false, hasParent: true });
    assert.ok(!items.includes('setParent'));
    assert.ok(!items.includes('removeParent'));
  });
});
