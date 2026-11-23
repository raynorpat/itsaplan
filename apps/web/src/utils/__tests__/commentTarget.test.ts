import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentTargetInput, commentTargetKey } from '@/utils/commentTarget';

// A comment target is the issue, document, project, project update or initiative
// update a comment thread belongs to: it decides the commentCreate input field and
// the cache entry to refresh.

describe('commentTargetInput', () => {
  it('posts to the issue', () => {
    assert.deepEqual(commentTargetInput({ issueId: 'i1' }), { issueId: 'i1' });
  });

  it('posts to the document with its content id', () => {
    assert.deepEqual(commentTargetInput({ documentId: 'd1' }), { documentContentId: 'd1' });
  });

  it('posts to the project', () => {
    assert.deepEqual(commentTargetInput({ projectId: 'p1' }), { projectId: 'p1' });
  });

  it('posts to the project update, not to its project', () => {
    assert.deepEqual(commentTargetInput({ projectUpdateId: 'u1', projectId: 'p1' }), {
      projectUpdateId: 'u1',
    });
  });

  it('posts to the initiative update', () => {
    assert.deepEqual(commentTargetInput({ initiativeUpdateId: 'u1', initiativeId: 'n1' }), {
      initiativeUpdateId: 'u1',
    });
  });
});

describe('commentTargetKey', () => {
  it("refreshes the issue's feed", () => {
    assert.deepEqual(commentTargetKey({ issueId: 'i1' }), ['feed', 'i1']);
  });

  it("refreshes the document's comments, not an issue feed", () => {
    assert.deepEqual(commentTargetKey({ documentId: 'd1' }), ['documentComments', 'd1']);
  });

  it("refreshes the project's activity", () => {
    assert.deepEqual(commentTargetKey({ projectId: 'p1' }), ['projectActivity', 'p1']);
  });

  it("refreshes the project's updates, which hold each update's comments", () => {
    assert.deepEqual(commentTargetKey({ projectUpdateId: 'u1', projectId: 'p1' }), [
      'projectUpdates',
      'p1',
    ]);
  });

  it("refreshes the initiative's updates, which hold each update's comments", () => {
    assert.deepEqual(commentTargetKey({ initiativeUpdateId: 'u1', initiativeId: 'n1' }), [
      'initiativeUpdates',
      'n1',
    ]);
  });
});
