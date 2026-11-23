import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { delegateCandidates } from '@/utils/delegates';
import { buildGroups, buildMaps } from '@/utils/team';

const apps = [
  { id: 'a1', name: 'Coder', avatarUrl: null, isMentionable: true, isAssignable: true },
  { id: 'a2', name: 'Notifier', avatarUrl: null, isMentionable: true, isAssignable: false },
];

describe('delegateCandidates', () => {
  it('offers only app users whose install allows delegation, marked as apps', () => {
    assert.deepEqual(delegateCandidates(apps), [
      { userId: 'a1', name: 'Coder', email: '', image: null, app: true },
    ]);
  });
});

describe('delegate grouping and lookups', () => {
  const team = {
    states: [],
    labels: [],
    assignees: [{ userId: 'p1', name: 'Ann', email: 'a@x', image: null }],
    delegates: delegateCandidates(apps),
    teamCycles: [],
    cycles: { enabled: false },
    issues: [] as Issue[],
  } as unknown as TeamDetail;

  it('gives every delegate a lane, then "No delegate"', () => {
    assert.deepEqual(
      buildGroups(team, 'delegate').map((g) => [g.key, g.name]),
      [
        ['da1', 'Coder'],
        ['d-none', 'No delegate'],
      ],
    );
  });

  it('resolves a delegate id for cards and cells', () => {
    assert.equal(buildMaps(team).assigneeById.get('a1')?.name, 'Coder');
  });
});
