import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectRelationItem, RelationEnd } from '@/utils/projectRelations';
import type { ProjectPositions } from '../projectTimeline';
import { anchorX, arrowPaths, offscreenMarkers } from '../arrows';

const end = (
  projectId: string,
  anchorType: RelationEnd['anchorType'],
  over: Partial<RelationEnd> = {},
): RelationEnd => ({
  projectId,
  projectName: projectId.toUpperCase(),
  startDate: '2026-03-01',
  targetDate: '2026-03-10',
  anchorType,
  milestone: null,
  ...over,
});

const relation = (id: string, from: RelationEnd, to: RelationEnd): ProjectRelationItem => ({
  id,
  from,
  to,
});

const positions: ProjectPositions = new Map([
  ['a', { y: 18, startX: 100, endX: 200, milestoneX: new Map([['m1', 150]]) }],
  ['b', { y: 90, startX: 260, endX: 400, milestoneX: new Map() }],
]);

describe('anchorX', () => {
  it('uses the start, end or milestone x of the project', () => {
    const pos = positions.get('a')!;
    assert.equal(anchorX(pos, end('a', 'start')), 100);
    assert.equal(anchorX(pos, end('a', 'end')), 200);
    assert.equal(
      anchorX(pos, end('a', 'milestone', { milestone: { id: 'm1', name: 'M', targetDate: null } })),
      150,
    );
  });

  it('is null for a milestone not on the timeline', () => {
    const pos = positions.get('a')!;
    assert.equal(
      anchorX(pos, end('a', 'milestone', { milestone: { id: 'mx', name: 'X', targetDate: null } })),
      null,
    );
  });
});

describe('arrowPaths', () => {
  it('draws from the blocking anchor to the blocked anchor with right angles', () => {
    const [arrow] = arrowPaths(
      [relation('r1', end('a', 'end'), end('b', 'start', { startDate: '2026-03-20' }))],
      positions,
    );
    assert.equal(arrow!.id, 'r1');
    assert.equal(arrow!.fromId, 'a');
    assert.equal(arrow!.toId, 'b');
    assert.equal(arrow!.conflict, false);
    // Starts at a's end, finishes at b's start, only horizontal and vertical segments.
    assert.match(arrow!.d, /^M 200 18 /);
    assert.match(arrow!.d, / H 260$/);
    assert.doesNotMatch(arrow!.d, /[LCQ]/);
  });

  it('marks a relation whose dates conflict', () => {
    const [arrow] = arrowPaths(
      [
        relation(
          'r1',
          end('a', 'end', { targetDate: '2026-04-01' }),
          end('b', 'start', { startDate: '2026-03-15' }),
        ),
      ],
      positions,
    );
    assert.equal(arrow!.conflict, true);
  });

  it('skips a relation when either project is not on the timeline', () => {
    assert.deepEqual(
      arrowPaths([relation('r1', end('a', 'end'), end('c', 'start'))], positions),
      [],
    );
  });

  it('reaches a blocked anchor to the left of the blocking one', () => {
    const [arrow] = arrowPaths([relation('r1', end('b', 'end'), end('a', 'start'))], positions);
    assert.match(arrow!.d, /^M 400 90 /);
    assert.match(arrow!.d, / H 100$/);
  });
});

describe('offscreenMarkers', () => {
  it('marks the shown side when the other project is not on the timeline', () => {
    const markers = offscreenMarkers(
      [
        relation('r1', end('a', 'end'), end('c', 'start')),
        relation('r2', end('d', 'end'), end('b', 'start')),
      ],
      positions,
    );
    assert.deepEqual(
      markers.map((m) => [m.id, m.projectId, m.kind, m.otherName, m.x, m.y]),
      [
        ['r1', 'a', 'blocking', 'C', 200, 18],
        ['r2', 'b', 'blockedBy', 'D', 260, 90],
      ],
    );
  });

  it('marks nothing when both or neither project is shown', () => {
    assert.deepEqual(
      offscreenMarkers(
        [
          relation('r1', end('a', 'end'), end('b', 'start')),
          relation('r2', end('c', 'end'), end('d', 'start')),
        ],
        positions,
      ),
      [],
    );
  });
});

describe('conflict while dragging', () => {
  it('colours an arrow from the dates shown on the timeline, not the saved ones', () => {
    // Saved: A ends on 10 March, B starts on 20 March, no conflict. A is being dragged
    // to end on 25 March.
    const shown: ProjectPositions = new Map([
      [
        'a',
        {
          y: 18,
          startX: 100,
          endX: 200,
          milestoneX: new Map(),
          dates: { startDate: '2026-03-01', targetDate: '2026-03-25', milestones: new Map() },
        },
      ],
      [
        'b',
        {
          y: 90,
          startX: 260,
          endX: 400,
          milestoneX: new Map(),
          dates: { startDate: '2026-03-20', targetDate: '2026-03-30', milestones: new Map() },
        },
      ],
    ]);
    const r = relation(
      'r1',
      end('a', 'end', { targetDate: '2026-03-10' }),
      end('b', 'start', { startDate: '2026-03-20', targetDate: '2026-03-30' }),
    );
    assert.equal(arrowPaths([r], shown)[0]!.conflict, true);
    const markerOnly: ProjectPositions = new Map([['a', shown.get('a')!]]);
    assert.equal(offscreenMarkers([r], markerOnly)[0]!.conflict, true);
  });
});
