import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentParentInput, documentsKey } from '@/utils/documentParent';

// A document lives on an issue or on a project: the parent decides the
// documentCreate input field and the cache entry that lists its documents.

describe('documentParentInput', () => {
  it('creates on the issue', () => {
    assert.deepEqual(documentParentInput({ issueId: 'i1' }), { issueId: 'i1' });
  });
  it('creates on the project', () => {
    assert.deepEqual(documentParentInput({ projectId: 'p1' }), { projectId: 'p1' });
  });
});

describe('documentsKey', () => {
  it("lists an issue's documents under the issue", () => {
    assert.deepEqual(documentsKey({ issueId: 'i1' }), ['issueDocuments', 'i1']);
  });
  it("lists a project's documents under the project, apart from an issue's", () => {
    assert.deepEqual(documentsKey({ projectId: 'p1' }), ['projectDocuments', 'p1']);
    assert.notDeepEqual(documentsKey({ issueId: 'x' }), documentsKey({ projectId: 'x' }));
  });
});
