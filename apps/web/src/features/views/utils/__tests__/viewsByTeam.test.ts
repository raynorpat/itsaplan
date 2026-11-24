import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { View } from '@/types/team';
import { viewsByTeam } from '@/features/views/utils/viewsByTeam';

const view = (id: string, teamKey: string, teamName: string, updatedAt: string): View =>
  ({
    id,
    teamId: `t-${teamKey}`,
    teamKey,
    teamName,
    name: id,
    icon: null,
    filters: { conditions: [] },
    display: {},
    createdAt: updatedAt,
    updatedAt,
    shared: true,
    owner: null,
  }) as unknown as View;

describe('viewsByTeam', () => {
  it('groups views by team, teams by name, views newest first', () => {
    const groups = viewsByTeam([
      view('a', 'ENG', 'Engineering', '2026-01-01'),
      view('b', 'DES', 'Design', '2026-01-02'),
      view('c', 'ENG', 'Engineering', '2026-01-03'),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.teamKey, g.views.map((v) => v.id)]),
      [
        ['DES', ['b']],
        ['ENG', ['c', 'a']],
      ],
    );
  });

  it('returns nothing for no views', () => {
    assert.deepEqual(viewsByTeam([]), []);
  });
});
