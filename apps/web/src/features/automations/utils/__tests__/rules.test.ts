import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canCreateRule,
  canEditRule,
  reorderIds,
  sortOrderForMove,
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

describe('sortOrderForMove', () => {
  const rules = [rule('a', 1), rule('b', 2), rule('c', 4)];

  it('places a rule between its new neighbours', () => {
    assert.equal(sortOrderForMove(rules, ['a', 'c', 'b'], 'c'), 1.5);
  });

  it('places a rule before the first or after the last', () => {
    assert.equal(sortOrderForMove(rules, ['c', 'a', 'b'], 'c'), 0);
    assert.equal(sortOrderForMove(rules, ['b', 'c', 'a'], 'a'), 5);
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
