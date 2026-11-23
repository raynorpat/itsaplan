import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupRelations, type RelationRow } from '../relations';

// groupRelations: an issue's own relations (issue = this one) and its inverse
// relations (relatedIssue = this one) read as Linear groups them on the issue page.

const other = (id: string) => ({ id, identifier: id.toUpperCase(), title: `Issue ${id}` });

const own = (id: string, type: string, relatedId: string): RelationRow => ({
  id,
  type,
  issue: other('me'),
  relatedIssue: other(relatedId),
});
const inverse = (id: string, type: string, fromId: string): RelationRow => ({
  id,
  type,
  issue: other(fromId),
  relatedIssue: other('me'),
});

describe('groupRelations', () => {
  it('groups by direction and type', () => {
    const groups = groupRelations(
      [own('r1', 'blocks', 'a'), own('r2', 'related', 'b'), own('r3', 'duplicate', 'c')],
      [
        inverse('r4', 'blocks', 'd'),
        inverse('r5', 'related', 'e'),
        inverse('r6', 'duplicate', 'f'),
      ],
    );
    const ids = (kind: string) =>
      groups.find((g) => g.kind === kind)?.items.map((i) => i.issue.id) ?? [];
    assert.deepEqual(ids('blocks'), ['a']);
    assert.deepEqual(ids('blockedBy'), ['d']);
    assert.deepEqual(ids('related'), ['b', 'e']);
    assert.deepEqual(ids('duplicateOf'), ['c']);
    assert.deepEqual(ids('duplicatedBy'), ['f']);
  });

  it('keeps the relation id for removal and leaves out empty groups', () => {
    const groups = groupRelations([own('r1', 'blocks', 'a')], []);
    assert.deepEqual(
      groups.map((g) => g.kind),
      ['blocks'],
    );
    assert.equal(groups[0]!.items[0]!.relationId, 'r1');
  });

  it('orders groups blocked by, blocks, related, duplicate of, duplicated by', () => {
    const groups = groupRelations(
      [own('r1', 'duplicate', 'a'), own('r2', 'related', 'b'), own('r3', 'blocks', 'c')],
      [inverse('r4', 'duplicate', 'd'), inverse('r5', 'blocks', 'e')],
    );
    assert.deepEqual(
      groups.map((g) => g.kind),
      ['blockedBy', 'blocks', 'related', 'duplicateOf', 'duplicatedBy'],
    );
  });
});
