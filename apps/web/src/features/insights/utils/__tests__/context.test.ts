import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextFromTeam, mergeContext } from '../context';
import type { TeamDetail } from '@/types/team';

describe('insights context', () => {
  it('reads names from the team', () => {
    const team = {
      team: { id: 't', name: 'Engineering' },
      states: [{ id: 's', name: 'Todo', stateType: 'unstarted', position: 2, color: '#888' }],
      assignees: [{ userId: 'u', name: 'Pat' }],
      mentionCandidates: [{ userId: 'a', name: 'Bot' }],
      labels: [{ id: 'l', name: 'Bug' }],
      teamCycles: [{ id: 'c', number: 3, name: null }],
    } as unknown as TeamDetail;
    const ctx = contextFromTeam(team);
    assert.deepEqual(ctx.states.get('s'), {
      name: 'Todo',
      type: 'unstarted',
      position: 2,
      color: '#888',
    });
    assert.equal(ctx.users.get('u'), 'Pat');
    assert.equal(ctx.users.get('a'), 'Bot');
    assert.equal(ctx.labels.get('l'), 'Bug');
    assert.equal(ctx.cycles.get('c'), 'Cycle 3');
    assert.equal(ctx.teams.get('t'), 'Engineering');
  });
  it('fills gaps from fetched names, the base winning', () => {
    const base = {
      states: new Map(),
      users: new Map([['u', 'Pat']]),
      labels: new Map(),
      cycles: new Map(),
      teams: new Map(),
    };
    const extra = {
      states: new Map([['s', { name: 'Done', type: 'completed', position: 3 }]]),
      users: new Map([
        ['u', 'Old name'],
        ['v', 'Sam'],
      ]),
      labels: new Map(),
      cycles: new Map([['c', 'Cycle 1']]),
      teams: new Map(),
    };
    const ctx = mergeContext(base, extra);
    assert.equal(ctx.users.get('u'), 'Pat');
    assert.equal(ctx.users.get('v'), 'Sam');
    assert.equal(ctx.states.get('s')?.name, 'Done');
    assert.equal(ctx.cycles.get('c'), 'Cycle 1');
  });
});
