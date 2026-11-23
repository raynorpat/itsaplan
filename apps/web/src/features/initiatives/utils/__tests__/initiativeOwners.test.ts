import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownerCandidates } from '../initiativeOwners';

// Who the owner picker offers: the users the API accepts as owner, that is users who
// can see the initiative through its lead team.

const users = [
  { id: 'a', guest: false, active: true },
  { id: 'b', guest: false, active: true },
  { id: 'g', guest: true, active: true },
  { id: 'x', guest: false, active: false },
];

describe('ownerCandidates', () => {
  it('offers active non-guests when there is no lead team', () => {
    assert.deepEqual(
      ownerCandidates(users, null).map((u) => u.id),
      ['a', 'b'],
    );
  });

  it('offers active non-guests when the lead team is public', () => {
    assert.deepEqual(
      ownerCandidates(users, { private: false, memberIds: ['a'] }).map((u) => u.id),
      ['a', 'b'],
    );
  });

  it("offers only the private lead team's non-guest members", () => {
    assert.deepEqual(
      ownerCandidates(users, { private: true, memberIds: ['b', 'g'] }).map((u) => u.id),
      ['b'],
    );
  });
});
