import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sortInitiatives, type SortableInitiative } from '../sortInitiatives';

const row = (over: Partial<SortableInitiative> & { id: string }): SortableInitiative => ({
  name: over.id,
  health: null,
  targetDate: null,
  owner: null,
  projectCount: 0,
  ...over,
});

const ids = (rows: SortableInitiative[]) => rows.map((r) => r.id);

const rows = [
  row({
    id: 'b',
    name: 'beta',
    health: 'offTrack',
    targetDate: '2026-03-01',
    owner: { name: 'zed' },
    projectCount: 2,
  }),
  row({ id: 'a', name: 'Alpha', health: 'onTrack', owner: { name: 'Amy' }, projectCount: 5 }),
  row({ id: 'c', name: 'charlie', health: 'atRisk', targetDate: '2026-01-15', projectCount: 1 }),
  row({ id: 'd', name: 'Delta' }),
];

describe('sortInitiatives', () => {
  it('keeps the loaded order without a sort', () => {
    assert.deepEqual(ids(sortInitiatives(rows, undefined, 'asc')), ['b', 'a', 'c', 'd']);
  });

  it('sorts names ignoring case', () => {
    assert.deepEqual(ids(sortInitiatives(rows, 'name', 'asc')), ['a', 'b', 'c', 'd']);
    assert.deepEqual(ids(sortInitiatives(rows, 'name', 'desc')), ['d', 'c', 'b', 'a']);
  });

  it('sorts health on track, at risk, off track, with no update last either way', () => {
    assert.deepEqual(ids(sortInitiatives(rows, 'health', 'asc')), ['a', 'c', 'b', 'd']);
    assert.deepEqual(ids(sortInitiatives(rows, 'health', 'desc')), ['b', 'c', 'a', 'd']);
  });

  it('sorts owners by name ignoring case, with no owner last either way', () => {
    assert.deepEqual(ids(sortInitiatives(rows, 'owner', 'asc')), ['a', 'b', 'c', 'd']);
    assert.deepEqual(ids(sortInitiatives(rows, 'owner', 'desc')), ['b', 'a', 'c', 'd']);
  });

  it('sorts target dates, with no date last either way', () => {
    assert.deepEqual(ids(sortInitiatives(rows, 'targetDate', 'asc')), ['c', 'b', 'a', 'd']);
    assert.deepEqual(ids(sortInitiatives(rows, 'targetDate', 'desc')), ['b', 'c', 'a', 'd']);
  });

  it('sorts by project count', () => {
    assert.deepEqual(ids(sortInitiatives(rows, 'projects', 'asc')), ['d', 'c', 'b', 'a']);
    assert.deepEqual(ids(sortInitiatives(rows, 'projects', 'desc')), ['a', 'b', 'c', 'd']);
  });
});
