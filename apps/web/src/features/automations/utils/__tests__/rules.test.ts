import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canCreateRule,
  canEditRule,
  normalizeRule,
  ownerName,
  reorderIds,
  reorderWrites,
  triggerSummary,
  type WorkflowRule,
} from '../rules';

function rule(id: string, sortOrder: number, archivedAt: string | null = null): WorkflowRule {
  return {
    id,
    teamId: 't1',
    name: id,
    description: null,
    trigger: 'entityCreated',
    activationMode: null,
    conditions: {},
    activities: [],
    enabled: true,
    sortOrder,
    editAccess: 'everyone',
    ownerId: 'u1',
    lastExecutedAt: null,
    stats: { runs: 0 },
    archivedAt,
    updatedAt: '2026-11-24T09:00:00.000Z',
  };
}

const member = { id: 'u2', role: 'member' as const, managesTeam: false };

describe('canEditRule', () => {
  it('refuses a guest whatever the edit access', () => {
    const guest = { id: 'u1', role: 'guest' as const, managesTeam: true };
    assert.equal(canEditRule({ editAccess: 'everyone', ownerId: 'u1' }, guest), false);
  });

  it('lets a workspace admin or owner edit any rule', () => {
    for (const role of ['admin', 'owner'] as const) {
      const viewer = { id: 'u9', role, managesTeam: false };
      assert.equal(canEditRule({ editAccess: 'owner', ownerId: 'u1' }, viewer), true);
      assert.equal(canEditRule({ editAccess: 'workspaceAdmins', ownerId: 'u1' }, viewer), true);
    }
  });

  it('follows the edit access for a member', () => {
    assert.equal(canEditRule({ editAccess: 'everyone', ownerId: 'u1' }, member), true);
    assert.equal(canEditRule({ editAccess: 'teamOwners', ownerId: 'u1' }, member), false);
    assert.equal(
      canEditRule({ editAccess: 'teamOwners', ownerId: 'u1' }, { ...member, managesTeam: true }),
      true,
    );
    assert.equal(
      canEditRule(
        { editAccess: 'workspaceAdmins', ownerId: 'u2' },
        { ...member, managesTeam: true },
      ),
      false,
    );
    assert.equal(canEditRule({ editAccess: 'owner', ownerId: 'u1' }, member), false);
    assert.equal(canEditRule({ editAccess: 'owner', ownerId: 'u2' }, member), true);
  });
});

describe('canCreateRule', () => {
  it('needs a team manager or a workspace admin, never a guest', () => {
    assert.equal(canCreateRule({ role: 'member', managesTeam: false }), false);
    assert.equal(canCreateRule({ role: 'member', managesTeam: true }), true);
    assert.equal(canCreateRule({ role: 'admin', managesTeam: false }), true);
    assert.equal(canCreateRule({ role: 'guest', managesTeam: true }), false);
  });
});

describe('reorderIds', () => {
  it('moves a rule and leaves archived rules out', () => {
    const rules = [rule('a', 1), rule('x', 2, '2026-11-01T00:00:00Z'), rule('b', 3), rule('c', 4)];
    assert.deepEqual(reorderIds(rules, 'c', 'a'), ['c', 'a', 'b']);
    assert.deepEqual(reorderIds(rules, 'a', 'c'), ['b', 'c', 'a']);
  });

  it('keeps the order when a rule is dropped on itself or an unknown id', () => {
    const rules = [rule('a', 1), rule('b', 2)];
    assert.deepEqual(reorderIds(rules, 'a', 'a'), ['a', 'b']);
    assert.deepEqual(reorderIds(rules, 'a', 'zz'), ['a', 'b']);
  });
});

describe('reorderWrites', () => {
  it('writes only the moved rule when its neighbours leave room', () => {
    const rules = [rule('a', 1), rule('b', 2), rule('c', 3)];
    assert.deepEqual(reorderWrites(rules, ['a', 'c', 'b'], 'c'), [{ id: 'c', sortOrder: 1.5 }]);
  });

  it('writes the moved rule one below the first or one above the last', () => {
    const rules = [rule('a', 1), rule('b', 2), rule('c', 4)];
    assert.deepEqual(reorderWrites(rules, ['c', 'a', 'b'], 'c'), [{ id: 'c', sortOrder: 0 }]);
    assert.deepEqual(reorderWrites(rules, ['b', 'c', 'a'], 'a'), [{ id: 'a', sortOrder: 5 }]);
  });

  it('renumbers the rules whose place changes when the neighbours share a sortOrder', () => {
    const rules = [rule('a', 1), rule('b', 1), rule('c', 2)];
    assert.deepEqual(reorderWrites(rules, ['a', 'c', 'b'], 'c'), [
      { id: 'a', sortOrder: 1000 },
      { id: 'c', sortOrder: 2000 },
      { id: 'b', sortOrder: 3000 },
    ]);
  });

  it('leaves out rules already at their renumbered value', () => {
    const rules = [rule('a', 1000), rule('b', 1000), rule('c', 3000)];
    assert.deepEqual(reorderWrites(rules, ['a', 'c', 'b'], 'c'), [
      { id: 'c', sortOrder: 2000 },
      { id: 'b', sortOrder: 3000 },
    ]);
  });
});

describe('ownerName', () => {
  const people = [{ userId: 'u1', name: 'Bob' }];
  it('names the owner, a former member, or no one', () => {
    assert.equal(ownerName('u1', people), 'Bob');
    assert.equal(ownerName('u9', people), 'a former member');
    assert.equal(ownerName(null, people), null);
  });
});

describe('triggerSummary', () => {
  it('names the trigger', () => {
    assert.equal(triggerSummary(rule('a', 1)), 'When an issue is created');
    assert.equal(
      triggerSummary({ ...rule('a', 1), trigger: 'entityUpdated' }),
      'When an issue starts matching the conditions',
    );
  });
});

describe('normalizeRule', () => {
  it('turns dates the auth client parsed back into ISO strings', () => {
    const raw = {
      ...rule('a', 1),
      lastExecutedAt: new Date('2026-11-24T10:00:00.000Z'),
      archivedAt: new Date('2026-11-25T10:00:00.000Z'),
      updatedAt: new Date('2026-11-26T10:00:00.000Z'),
    } as unknown as WorkflowRule;
    const out = normalizeRule(raw);
    assert.equal(out.lastExecutedAt, '2026-11-24T10:00:00.000Z');
    assert.equal(out.archivedAt, '2026-11-25T10:00:00.000Z');
    assert.equal(out.updatedAt, '2026-11-26T10:00:00.000Z');
  });

  it('keeps strings and nulls', () => {
    const r = { ...rule('a', 1), lastExecutedAt: '2026-11-24T10:00:00.000Z' };
    assert.deepEqual(normalizeRule(r), r);
  });
});
