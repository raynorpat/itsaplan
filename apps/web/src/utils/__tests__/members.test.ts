import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  membershipOf,
  needsTeamOwners,
  roleFromFlags,
  teamAccess,
  toMemberRows,
  toWorkspaceUser,
} from '@/utils/members';

// Team members and workspace users as GraphQL returns them (Linear's role flags and
// TeamMembership nodes), mapped to the rows the Members pages show.

const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.com`,
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  active: true,
  owner: false,
  admin: false,
  guest: false,
  ...extra,
});

describe('roleFromFlags', () => {
  it('reads Linear role flags as a workspace role', () => {
    assert.equal(roleFromFlags({ owner: true, admin: true, guest: false }), 'owner');
    assert.equal(roleFromFlags({ owner: false, admin: true, guest: false }), 'admin');
    assert.equal(roleFromFlags({ owner: false, admin: false, guest: true }), 'guest');
    assert.equal(roleFromFlags({ owner: false, admin: false, guest: false }), 'member');
  });
});

describe('toWorkspaceUser', () => {
  it('maps a user with its role and suspension', () => {
    assert.deepEqual(toWorkspaceUser(user('a', { admin: true, active: false })), {
      userId: 'a',
      name: 'User a',
      email: 'a@example.com',
      image: null,
      role: 'admin',
      suspended: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('toMemberRows', () => {
  it('maps memberships to member rows with the team owner flag as the role', () => {
    const rows = toMemberRows('team-1', [
      { id: 'm1', owner: true, createdAt: '2026-02-01T00:00:00.000Z', user: user('a') },
      { id: 'm2', owner: false, createdAt: '2026-02-02T00:00:00.000Z', user: user('b') },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.membershipId, r.teamId, r.userId, r.role, r.createdAt]),
      [
        ['m1', 'team-1', 'a', 'owner', '2026-02-01T00:00:00.000Z'],
        ['m2', 'team-1', 'b', 'member', '2026-02-02T00:00:00.000Z'],
      ],
    );
  });
});

describe('membershipOf', () => {
  it('finds the membership of a user, or null', () => {
    const rows = toMemberRows('team-1', [
      { id: 'm1', owner: false, createdAt: '2026-02-01T00:00:00.000Z', user: user('a') },
    ]);
    assert.equal(membershipOf(rows, 'a')?.membershipId, 'm1');
    assert.equal(membershipOf(rows, 'z'), null);
  });
});

describe('team access for the teams list', () => {
  const member = { id: 'me', admin: false, owner: false, guest: false };
  const admin = { id: 'me', admin: true, owner: false, guest: false };

  it("takes the viewer's role from their own membership, wherever it is in the team", () => {
    assert.equal(teamAccess(member, [{ userId: 'me', owner: true }]).role, 'owner');
    assert.equal(teamAccess(member, []).role, null);
  });

  it('asks for the team owners only when they decide the manage right', () => {
    // A plain member of the team: canManage depends on whether the team has owners.
    assert.equal(needsTeamOwners(member, { owner: false }), true);
    // A team owner, a workspace admin, or a non-member: it does not.
    assert.equal(needsTeamOwners(member, { owner: true }), false);
    assert.equal(needsTeamOwners(admin, { owner: false }), false);
    assert.equal(needsTeamOwners(member, null), false);
  });

  it('refuses manage to a plain member when an owner exists past the first page', () => {
    const all = [
      ...Array.from({ length: 300 }, (_, i) => ({ userId: `u${i}`, owner: false })),
      { userId: 'boss', owner: true },
      { userId: 'me', owner: false },
    ];
    assert.equal(teamAccess(member, all).canManage, false);
  });
});
