import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cycle, Issue, TeamDetail } from '@/lib/api';
import { buildGroups, groupIssues, groupKeyOf, buildMaps } from '../team';
import { cycleSafeSettings, defaultViewSettings } from '../viewSettings';
import { applyFilters } from '../filters';
import { buildFieldSpecs } from '../filterFields';

// The cycle on the board: grouping by cycle, the cycle filter, and both gated on the
// team's cycles being on.

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
const cycle = (id: string, n: number, from: number, to: number, done = false): Cycle => ({
  id,
  number: n,
  name: null,
  startsAt: iso(from),
  endsAt: iso(to),
  completedAt: done ? iso(to) : null,
});
const past = cycle('p', 1, -14, -7, true);
const older = cycle('o', 0, -21, -14, true);
const current = cycle('c', 2, -3, 4);
const next = cycle('n', 3, 4, 11);

const issue = (id: string, cycleId: string | null) =>
  ({ id, cycleId, stateId: 's1', labelIds: [], priority: 0 }) as unknown as Issue;

const team = (enabled: boolean, issues: Issue[]): TeamDetail =>
  ({
    team: { id: 't', key: 'MKT', name: 'Marketing' },
    cycles: { enabled },
    teamCycles: [next, older, past, current],
    states: [],
    labels: [],
    labelGroups: [],
    assignees: [],
    viewer: { role: 'member', workspaceRole: 'member', canManage: false },
    issues,
  }) as unknown as TeamDetail;

describe('grouping by cycle', () => {
  it('shows the current and upcoming cycles, past cycles with issues, then "No cycle"', () => {
    const groups = buildGroups(team(true, [issue('1', 'p'), issue('2', null)]), 'cycle');
    assert.deepEqual(
      groups.map((g) => [g.key, g.name]),
      [
        ['yc', 'Cycle 2'],
        ['yn', 'Cycle 3'],
        ['yp', 'Cycle 1'],
        ['y-none', 'No cycle'],
      ],
    );
    assert.deepEqual(groups[0]!.assign, { cycleId: 'c' });
    assert.deepEqual(groups.at(-1)!.assign, { cycleId: null });
  });

  it('puts an issue in its cycle group', () => {
    assert.equal(groupKeyOf(issue('1', 'c'), 'cycle'), 'yc');
    assert.equal(groupKeyOf(issue('2', null), 'cycle'), 'y-none');
  });
});

describe('cycle filter', () => {
  const issues = [issue('1', 'c'), issue('2', 'n'), issue('3', null)];
  const filter = (op: 'is' | 'is_not', values: (string | null)[]) => ({
    conditions: [{ id: 'x', field: 'cycle', op, values }],
  });

  it('keeps issues in the chosen cycles, "No cycle" included', () => {
    const t = team(true, issues);
    assert.deepEqual(
      applyFilters(issues, filter('is', ['c', null]), t).map((i) => i.id),
      ['1', '3'],
    );
    assert.deepEqual(
      applyFilters(issues, filter('is_not', ['c']), t).map((i) => i.id),
      ['2', '3'],
    );
  });

  it('is offered only when the team has cycles on, current cycle first', () => {
    const on = buildFieldSpecs(team(true, issues)).find((s) => s.field === 'cycle');
    assert.deepEqual(
      on?.options?.map((o) => o.value),
      ['c', 'n', 'p', 'o', null],
    );
    assert.equal(
      buildFieldSpecs(team(false, issues)).some((s) => s.field === 'cycle'),
      false,
    );
  });
});

describe('cycles not in the team list', () => {
  const ancient = cycle('a', 0, -400, -393, true);
  const withCycle = (id: string, c: Cycle) => ({ ...issue(id, c.id), cycle: c }) as Issue;

  it('groups an issue whose cycle is not in the team list under that cycle', () => {
    const t = team(true, [withCycle('1', ancient)]);
    const groups = buildGroups(t, 'cycle');
    assert.ok(groups.some((g) => g.key === 'ya' && g.name === 'Cycle 0'));
    const byGroup = groupIssues(groups, t.issues, 'cycle');
    assert.deepEqual(
      byGroup.get('ya')?.map((i) => i.id),
      ['1'],
    );
  });

  it('keeps an issue whose cycle is not known at all, as "Unknown cycle"', () => {
    const t = team(true, [issue('1', 'zzz')]);
    const groups = buildGroups(t, 'cycle');
    assert.ok(groups.some((g) => g.key === 'yzzz' && g.name === 'Unknown cycle'));
    assert.deepEqual(
      groupIssues(groups, t.issues, 'cycle')
        .get('yzzz')
        ?.map((i) => i.id),
      ['1'],
    );
  });

  it('lists the cycle in the filter and the badge map', () => {
    const t = team(true, [withCycle('1', ancient)]);
    const spec = buildFieldSpecs(t).find((s) => s.field === 'cycle');
    assert.ok(spec?.options?.some((o) => o.value === 'a' && o.label === 'Cycle 0'));
    assert.equal(buildMaps(t).cycleById.get('a')?.number, 0);
  });
});

describe('cycles turned off', () => {
  it('ignores a stored cycle filter', () => {
    const issues = [issue('1', 'c'), issue('2', null)];
    const filters = { conditions: [{ id: 'x', field: 'cycle', op: 'is', values: ['c'] }] };
    assert.deepEqual(
      applyFilters(issues, filters as never, team(false, issues)).map((i) => i.id),
      ['1', '2'],
    );
  });

  it('falls back from cycle grouping to the default grouping', () => {
    const settings = {
      ...defaultViewSettings('kanban'),
      group: 'cycle',
      subgroup: 'cycle',
    } as const;
    const off = cycleSafeSettings(settings, 'kanban', false);
    assert.equal(off.group, 'status');
    assert.equal(off.subgroup, 'none');
    assert.equal(cycleSafeSettings(settings, 'kanban', true).group, 'cycle');
  });
});
