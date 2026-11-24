import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { issueMenuItems } from '../issueActions';

// issueMenuItems: the entries of the issue's ⋯ menu, hiding what the API would refuse.
describe('issueMenuItems', () => {
  it('lists copy, archive and delete for an editor who may delete', () => {
    assert.deepEqual(issueMenuItems({ canEdit: true, canDelete: true, archived: false }), [
      'copyLink',
      'copyPrompt',
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
