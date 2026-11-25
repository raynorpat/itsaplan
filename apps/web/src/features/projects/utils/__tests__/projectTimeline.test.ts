import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectTimeline,
  dropDates,
  flattenTimelineRows,
  projectPositions,
  patchTimeline,
  projectSpan,
  revertTimelineWrite,
  toggleCollapsedGroup,
  collapsedGroups,
  rowsHeight,
  shiftProjectDates,
  withPreview,
  type TimelineProject,
} from '../projectTimeline';

const project = (id: string, over: Partial<TimelineProject> = {}): TimelineProject => ({
  id,
  name: id.toUpperCase(),
  status: 'started',
  health: null,
  startDate: '2026-03-01',
  targetDate: '2026-03-31',
  leadUserId: null,
  teams: [],
  initiatives: [],
  milestones: [],
  ...over,
});

const leadName = (id: string) => ({ u1: 'Ana', u2: 'Ben' })[id] ?? 'Unknown';

// Runs `fn` with the process in time zone `tz`, so a daylight saving change happens
// inside the dates tested whatever the machine's zone (CI runs in UTC).
function inTimeZone(tz: string, fn: () => void) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('buildProjectTimeline', () => {
  it('puts every dated project in one group without grouping', () => {
    const t = buildProjectTimeline([project('a'), project('b')], { grouping: 'none', leadName });
    assert.deepEqual(
      t.groups.map((g) => [g.key, g.rows.map((r) => r.projectId)]),
      [['all', ['a', 'b']]],
    );
    assert.deepEqual(t.noDates, []);
  });

  it('groups by status in lifecycle order', () => {
    const t = buildProjectTimeline(
      [project('a', { status: 'completed' }), project('b', { status: 'planned' })],
      { grouping: 'status', leadName },
    );
    assert.deepEqual(
      t.groups.map((g) => [g.label, g.rows.map((r) => r.projectId)]),
      [
        ['Planned', ['b']],
        ['Completed', ['a']],
      ],
    );
  });

  it('shows a project of two teams in both team groups, numbering the copies', () => {
    const eng = { id: 't1', name: 'Engineering' };
    const des = { id: 't2', name: 'Design' };
    const t = buildProjectTimeline(
      [project('a', { teams: [eng, des] }), project('b', { teams: [eng] })],
      { grouping: 'team', leadName },
    );
    assert.deepEqual(
      t.groups.map((g) => [g.label, g.rows.map((r) => `${r.projectId}#${r.copyIndex}`)]),
      [
        ['Design', ['a#0']],
        ['Engineering', ['a#1', 'b#0']],
      ],
    );
  });

  it('puts projects with no team or no initiative in their own last group', () => {
    const team = buildProjectTimeline([project('a')], { grouping: 'team', leadName });
    assert.deepEqual(
      team.groups.map((g) => [g.key, g.label]),
      [['none', 'No team']],
    );
    const init = buildProjectTimeline(
      [project('a', { initiatives: [{ id: 'i1', name: 'Growth' }] }), project('b')],
      { grouping: 'initiative', leadName },
    );
    assert.deepEqual(
      init.groups.map((g) => [g.label, g.rows.map((r) => r.projectId)]),
      [
        ['Growth', ['a']],
        ['No initiative', ['b']],
      ],
    );
  });

  it('groups by lead name with no lead last', () => {
    const t = buildProjectTimeline(
      [project('a', { leadUserId: 'u2' }), project('b'), project('c', { leadUserId: 'u1' })],
      { grouping: 'lead', leadName },
    );
    assert.deepEqual(
      t.groups.map((g) => g.label),
      ['Ana', 'Ben', 'No lead'],
    );
  });

  it('lists projects without any date under No dates, not in a group', () => {
    const t = buildProjectTimeline(
      [project('a', { startDate: null, targetDate: null }), project('b')],
      { grouping: 'none', leadName },
    );
    assert.deepEqual(t.noDates, ['a']);
    assert.deepEqual(
      t.groups.map((g) => g.rows.map((r) => r.projectId)),
      [['b']],
    );
  });
});

describe('projectSpan', () => {
  it('spans start to target', () => {
    const span = projectSpan(project('a'))!;
    assert.equal(span.start.getDate(), 1);
    assert.equal(span.end.getDate(), 31);
    assert.equal(span.point, false);
  });

  it('shows a project with one date as a point on that date', () => {
    const onlyTarget = projectSpan(project('a', { startDate: null }))!;
    assert.equal(onlyTarget.point, true);
    assert.equal(onlyTarget.start.getTime(), onlyTarget.end.getTime());
    assert.equal(onlyTarget.start.getDate(), 31);
    const onlyStart = projectSpan(project('a', { targetDate: null }))!;
    assert.equal(onlyStart.point, true);
    assert.equal(onlyStart.start.getDate(), 1);
  });

  it('is null without dates', () => {
    assert.equal(projectSpan(project('a', { startDate: null, targetDate: null })), null);
  });
});

describe('shiftProjectDates', () => {
  it('moves both dates by the same days across a month end', () => {
    assert.deepEqual(
      shiftProjectDates({ startDate: '2026-01-25', targetDate: '2026-01-31' }, 'move', 3),
      { startDate: '2026-01-28', targetDate: '2026-02-03' },
    );
  });

  it('moves both dates by the same days across a daylight saving change', () => {
    // Europe changes on 29 March and 25 October 2026.
    inTimeZone('Europe/London', () => {
      assert.deepEqual(
        shiftProjectDates({ startDate: '2026-03-27', targetDate: '2026-03-30' }, 'move', 2),
        { startDate: '2026-03-29', targetDate: '2026-04-01' },
      );
      assert.deepEqual(
        shiftProjectDates({ startDate: '2026-10-23', targetDate: '2026-10-26' }, 'move', 7),
        { startDate: '2026-10-30', targetDate: '2026-11-02' },
      );
    });
  });

  it('changes one end and never passes the other', () => {
    assert.deepEqual(
      shiftProjectDates({ startDate: '2026-03-01', targetDate: '2026-03-10' }, 'end', 5),
      { startDate: '2026-03-01', targetDate: '2026-03-15' },
    );
    assert.deepEqual(
      shiftProjectDates({ startDate: '2026-03-01', targetDate: '2026-03-10' }, 'start', 20),
      { startDate: '2026-03-10', targetDate: '2026-03-10' },
    );
  });

  it('moves a one-date project and keeps the missing date empty', () => {
    assert.deepEqual(shiftProjectDates({ startDate: null, targetDate: '2026-03-10' }, 'move', 1), {
      startDate: null,
      targetDate: '2026-03-11',
    });
  });
});

describe('dropDates', () => {
  it('starts on the drop day and targets 14 days later', () => {
    assert.deepEqual(dropDates(new Date(2026, 2, 25)), {
      startDate: '2026-03-25',
      targetDate: '2026-04-08',
    });
  });
});

describe('flattenTimelineRows and projectPositions', () => {
  const eng = { id: 't1', name: 'Engineering' };
  const des = { id: 't2', name: 'Design' };
  const projects = [
    project('a', {
      teams: [eng, des],
      milestones: [{ id: 'm1', name: 'Beta', targetDate: '2026-03-15' }],
    }),
    project('b', { teams: [eng] }),
  ];
  const layout = buildProjectTimeline(projects, { grouping: 'team', leadName });

  it('lays out group headers and rows, leaving out collapsed groups', () => {
    const rows = flattenTimelineRows(layout, { collapsed: new Set(['t2']), headers: true });
    assert.deepEqual(
      rows.map((r) => [r.kind, r.kind === 'project' ? r.projectId : r.groupKey, r.top]),
      [
        ['group', 't2', 0],
        ['group', 't1', 32],
        ['project', 'a', 64],
        ['project', 'b', 100],
      ],
    );
  });

  it('places each project at its top-most visible copy with its anchors', () => {
    const rows = flattenTimelineRows(layout, { collapsed: new Set(), headers: true });
    const byId = new Map(projects.map((p) => [p.id, p]));
    const xOf = (d: Date) => d.getDate() * 10;
    const positions = projectPositions(rows, byId, xOf, 10);
    const a = positions.get('a')!;
    // Design (t2) comes first, so a's first copy is its top-most one.
    assert.equal(a.y, 32 + 18);
    assert.equal(a.startX, 10);
    // The end anchor is the right edge of the target day's column.
    assert.equal(a.endX, 31 * 10 + 10);
    assert.equal(a.milestoneX.get('m1'), 15 * 10 + 5);
    assert.equal(positions.get('b')!.y, 32 + 36 + 32 + 36 + 18);
  });
});

describe('withPreview and rowsHeight', () => {
  it('moves a dragged bar and milestone and keeps a one-date project one-date', () => {
    const p = project('a', {
      startDate: null,
      targetDate: '2026-03-10',
      milestones: [{ id: 'm1', name: 'Beta', targetDate: '2026-03-05' }],
    });
    const moved = withPreview(
      p,
      { start: new Date(2026, 2, 12), end: new Date(2026, 2, 12) },
      (id) => (id === 'm1' ? new Date(2026, 2, 7) : null),
    );
    assert.equal(moved.startDate, null);
    assert.equal(moved.targetDate, '2026-03-12');
    assert.equal(moved.milestones[0]!.targetDate, '2026-03-07');
    assert.deepEqual(
      withPreview(p, null, () => null),
      p,
    );
  });

  it('measures the rows down to the last one', () => {
    const layout = buildProjectTimeline([project('a'), project('b')], {
      grouping: 'status',
      leadName,
    });
    assert.equal(
      rowsHeight(flattenTimelineRows(layout, { collapsed: new Set(), headers: true })),
      32 + 36 + 36,
    );
    assert.equal(rowsHeight([]), 0);
  });
});

describe('patchTimeline and revertTimelineWrite', () => {
  it('undoes only the failed write when two drags overlap', () => {
    const before = [
      project('a'),
      project('b', { milestones: [{ id: 'm1', name: 'M1', targetDate: '2026-03-10' }] }),
    ];
    const first = {
      kind: 'project' as const,
      projectId: 'a',
      dates: { startDate: '2026-03-05', targetDate: '2026-04-04' },
    };
    const second = {
      kind: 'milestone' as const,
      projectId: 'b',
      milestoneId: 'm1',
      targetDate: '2026-03-20',
    };
    const afterFirst = patchTimeline(before, first);
    const afterBoth = patchTimeline(afterFirst, second);
    const reverted = revertTimelineWrite(afterBoth, before, first);
    assert.deepEqual(
      reverted.map((p) => [p.startDate, p.targetDate, p.milestones[0]?.targetDate ?? null]),
      [
        ['2026-03-01', '2026-03-31', null],
        ['2026-03-01', '2026-03-31', '2026-03-20'],
      ],
    );
  });

  it('undoes a failed milestone move and keeps the project dates', () => {
    const before = [
      project('b', { milestones: [{ id: 'm1', name: 'M1', targetDate: '2026-03-10' }] }),
    ];
    const move = {
      kind: 'milestone' as const,
      projectId: 'b',
      milestoneId: 'm1',
      targetDate: '2026-03-20',
    };
    const dates = {
      kind: 'project' as const,
      projectId: 'b',
      dates: { startDate: '2026-03-02', targetDate: '2026-04-01' },
    };
    const now = patchTimeline(patchTimeline(before, move), dates);
    const reverted = revertTimelineWrite(now, before, move);
    assert.deepEqual(reverted[0]!.milestones[0]!.targetDate, '2026-03-10');
    assert.deepEqual(
      [reverted[0]!.startDate, reverted[0]!.targetDate],
      ['2026-03-02', '2026-04-01'],
    );
  });
});

describe('collapsed groups', () => {
  it('keeps each grouping its own collapsed groups', () => {
    let state = toggleCollapsedGroup({}, 'team', 'none');
    assert.deepEqual([...collapsedGroups(state, 'team')], ['none']);
    assert.deepEqual([...collapsedGroups(state, 'lead')], []);
    state = toggleCollapsedGroup(state, 'team', 'none');
    assert.deepEqual([...collapsedGroups(state, 'team')], []);
  });
});

describe('lead groups', () => {
  it("names a lead from the project itself when the list's people do not include them", () => {
    const layout = buildProjectTimeline(
      [project('a', { leadUserId: 'u9', leadName: 'Zoe' }), project('b', { leadUserId: 'u1' })],
      { grouping: 'lead', leadName },
    );
    assert.deepEqual(
      layout.groups.map((g) => g.label),
      ['Ana', 'Zoe'],
    );
  });
});
