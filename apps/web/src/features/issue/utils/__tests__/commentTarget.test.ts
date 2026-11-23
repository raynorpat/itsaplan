import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentTargetInput, commentTargetKey } from '../commentTarget';

// A comment target is the issue or the document a comment thread belongs to: it
// decides the commentCreate input field and the cache entry to refresh.

describe('commentTargetInput', () => {
  it('posts to the issue', () => {
    assert.deepEqual(commentTargetInput({ issueId: 'i1' }), { issueId: 'i1' });
  });

  it('posts to the document with its content id', () => {
    assert.deepEqual(commentTargetInput({ documentId: 'd1' }), { documentContentId: 'd1' });
  });
});

describe('commentTargetKey', () => {
  it("refreshes the issue's feed", () => {
    assert.deepEqual(commentTargetKey({ issueId: 'i1' }), ['feed', 'i1']);
  });

  it("refreshes the document's comments, not an issue feed", () => {
    assert.deepEqual(commentTargetKey({ documentId: 'd1' }), ['documentComments', 'd1']);
  });
});
