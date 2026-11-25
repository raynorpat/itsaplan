import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FilterCondition } from '@/utils/filters';
import { conditionChips, withTeam } from '../filterChips';

const bug: FilterCondition = { id: 'b', field: 'labels', op: 'is', values: ['l-bug', 'l-bug2'] };
const notStarted: FilterCondition = {
  id: 's',
  field: 'statusType',
  op: 'is',
  values: ['backlog', 'unstarted'],
};
const team = (id: string): FilterCondition => ({ id: 't', field: 'team', op: 'is', values: [id] });

describe('withTeam', () => {
  it('keeps the other conditions when the team changes', () => {
    const next = withTeam([bug, team('t-eng')], 't-des');
    assert.deepEqual(
      next.filter((c) => c.field !== 'team'),
      [bug],
    );
    assert.deepEqual(next.find((c) => c.field === 'team')?.values, ['t-des']);
  });

  it('drops only the team condition for all teams', () => {
    assert.deepEqual(withTeam([team('t-eng'), bug, notStarted], null), [bug, notStarted]);
  });
});

describe('conditionChips', () => {
  it('describes the conditions besides the team, labels by name', () => {
    const names = new Map([
      ['l-bug', 'Bug'],
      ['l-bug2', 'bug'],
    ]);
    assert.deepEqual(conditionChips([team('t-eng'), bug, notStarted], names), [
      { id: 'b', text: 'Labels is Bug, bug' },
      { id: 's', text: 'State type is Backlog, Unstarted' },
    ]);
  });

  it('counts values it cannot name', () => {
    assert.deepEqual(conditionChips([{ ...bug, values: ['x', 'y', 'z'] }], new Map()), [
      { id: 'b', text: 'Labels is 3 values' },
    ]);
  });
});
