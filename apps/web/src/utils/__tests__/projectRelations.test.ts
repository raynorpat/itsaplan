import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anchorDate,
  anchorLabel,
  conflictingProjectIds,
  isConflict,
  relationsByProject,
  type ProjectRelationItem,
  type RelationEnd,
} from '@/utils/projectRelations';

const end = (over: Partial<RelationEnd> = {}): RelationEnd => ({
  projectId: 'p',
  projectName: 'P',
  startDate: '2026-01-10',
  targetDate: '2026-02-10',
  anchorType: 'end',
  milestone: null,
  ...over,
});

const relation = (from: RelationEnd, to: RelationEnd, id = 'r1'): ProjectRelationItem => ({
  id,
  from,
  to,
});

describe('anchorDate', () => {
  it('reads the start date, the target date or the milestone target date', () => {
    assert.equal(anchorDate(end({ anchorType: 'start' })), '2026-01-10');
    assert.equal(anchorDate(end({ anchorType: 'end' })), '2026-02-10');
    assert.equal(
      anchorDate(
        end({
          anchorType: 'milestone',
          milestone: { id: 'm', name: 'Beta', targetDate: '2026-01-20' },
        }),
      ),
      '2026-01-20',
    );
  });

  it('is null when the date or the milestone is missing', () => {
    assert.equal(anchorDate(end({ anchorType: 'start', startDate: null })), null);
    assert.equal(anchorDate(end({ anchorType: 'end', targetDate: null })), null);
    assert.equal(anchorDate(end({ anchorType: 'milestone', milestone: null })), null);
    assert.equal(
      anchorDate(
        end({ anchorType: 'milestone', milestone: { id: 'm', name: 'Beta', targetDate: null } }),
      ),
      null,
    );
  });
});

describe('isConflict', () => {
  it('is a conflict when the blocking date is after the blocked date', () => {
    // A ends Feb 10, B starts Feb 1: B starts before its blocker ends.
    const blocking = end({ projectId: 'a', anchorType: 'end', targetDate: '2026-02-10' });
    const blocked = end({ projectId: 'b', anchorType: 'start', startDate: '2026-02-01' });
    assert.equal(isConflict(relation(blocking, blocked)), true);
  });

  it('is no conflict when the blocking date is before or on the blocked date', () => {
    const blocking = end({ projectId: 'a', anchorType: 'end', targetDate: '2026-02-10' });
    assert.equal(
      isConflict(
        relation(blocking, end({ projectId: 'b', anchorType: 'start', startDate: '2026-02-11' })),
      ),
      false,
    );
    assert.equal(
      isConflict(
        relation(blocking, end({ projectId: 'b', anchorType: 'start', startDate: '2026-02-10' })),
      ),
      false,
    );
  });

  it('compares milestone anchors by their target dates', () => {
    const blocking = end({
      projectId: 'a',
      anchorType: 'milestone',
      milestone: { id: 'm', name: 'API ready', targetDate: '2026-03-01' },
    });
    const blocked = end({ projectId: 'b', anchorType: 'end', targetDate: '2026-02-20' });
    assert.equal(isConflict(relation(blocking, blocked)), true);
  });

  it('is never a conflict when either date is missing', () => {
    const blocking = end({ projectId: 'a', anchorType: 'end', targetDate: null });
    const blocked = end({ projectId: 'b', anchorType: 'start', startDate: '2026-01-01' });
    assert.equal(isConflict(relation(blocking, blocked)), false);
    assert.equal(
      isConflict(
        relation(
          end({ projectId: 'a', anchorType: 'end' }),
          end({ projectId: 'b', anchorType: 'start', startDate: null }),
        ),
      ),
      false,
    );
  });
});

describe('anchorLabel', () => {
  it('names the anchor in words', () => {
    assert.equal(anchorLabel('start'), 'start');
    assert.equal(anchorLabel('end'), 'end');
    assert.equal(anchorLabel('milestone', 'Beta'), 'milestone Beta');
    assert.equal(anchorLabel('milestone'), 'milestone');
  });
});

describe('relationsByProject', () => {
  it('lists each relation as blocking on its source and blocked by on its related project', () => {
    const r = relation(end({ projectId: 'a' }), end({ projectId: 'b', anchorType: 'start' }));
    const map = relationsByProject([r]);
    assert.deepEqual(map.get('a'), { blockedBy: [], blocking: [r] });
    assert.deepEqual(map.get('b'), { blockedBy: [r], blocking: [] });
    assert.equal(map.get('c'), undefined);
  });
});

describe('conflictingProjectIds', () => {
  it('lists both projects of every relation whose dates conflict', () => {
    const conflict = relation(
      end({ projectId: 'a', anchorType: 'end', targetDate: '2026-03-01' }),
      end({ projectId: 'b', anchorType: 'start', startDate: '2026-02-01' }),
      'r1',
    );
    const fine = relation(
      end({ projectId: 'c', anchorType: 'end', targetDate: '2026-01-01' }),
      end({ projectId: 'd', anchorType: 'start', startDate: '2026-02-01' }),
      'r2',
    );
    assert.deepEqual([...conflictingProjectIds([conflict, fine])].sort(), ['a', 'b']);
  });
});
