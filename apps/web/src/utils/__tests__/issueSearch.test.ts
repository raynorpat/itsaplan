import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSearchHit } from '../issueSearch';

describe('toSearchHit', () => {
  it('maps a searchIssues node to a palette hit', () => {
    assert.deepEqual(
      toSearchHit({
        id: 'i1',
        number: 42,
        identifier: 'ENG-42',
        title: 'Fix login',
        archivedAt: null,
      }),
      { id: 'i1', sequenceNumber: 42, identifier: 'ENG-42', title: 'Fix login', archived: false },
    );
  });

  it('marks an archived issue', () => {
    assert.equal(
      toSearchHit({
        id: 'i2',
        number: 7,
        identifier: 'ENG-7',
        title: 'Old',
        archivedAt: '2026-01-01T00:00:00.000Z',
      }).archived,
      true,
    );
  });
});
