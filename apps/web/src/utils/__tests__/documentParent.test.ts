import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentParentInput, documentsKey } from '@/utils/documentParent';
import { qk } from '@/services/queryKeys';

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
    assert.deepEqual(documentsKey({ issueId: 'i1' }), qk.issueDocuments('i1'));
  });
  it("lists a project's documents under the project", () => {
    assert.deepEqual(documentsKey({ projectId: 'p1' }), qk.projectDocuments('p1'));
  });
  it('keeps issue and project keys apart', () => {
    assert.notDeepEqual(documentsKey({ issueId: 'x' }), documentsKey({ projectId: 'x' }));
  });
});
