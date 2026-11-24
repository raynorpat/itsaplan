import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { archivedProjects, sortProjects, sumStatusCounts } from '../projectList';

// The projects list over GraphQL: the status tab counts and the sort.

describe('sumStatusCounts', () => {
  it('counts per status type and in total', () => {
    const counts = sumStatusCounts({ backlog: 2, planned: 1, started: 3, completed: 4 });
    assert.deepEqual(counts, {
      backlog: 2,
      planned: 1,
      started: 3,
      paused: 0,
      completed: 4,
      canceled: 0,
      total: 10,
    });
  });
});

describe('sortProjects', () => {
  const rows = [
    { id: 'a', name: 'Beta', priority: 0, targetDate: null, leadUserId: 'u2' },
    { id: 'b', name: 'alpha', priority: 3, targetDate: '2026-02-01', leadUserId: null },
    { id: 'c', name: 'Gamma', priority: 1, targetDate: '2026-01-01', leadUserId: 'u1' },
  ];
  const lead = (id: string | null) => (id === 'u1' ? 'Ann' : id === 'u2' ? 'Zed' : '');

  it('keeps the server order without a sort', () => {
    assert.deepEqual(
      sortProjects(rows, undefined, 'asc', lead).map((p) => p.id),
      ['a', 'b', 'c'],
    );
  });

  it('sorts by name ignoring case, and descending', () => {
    assert.deepEqual(
      sortProjects(rows, 'name', 'asc', lead).map((p) => p.id),
      ['b', 'a', 'c'],
    );
    assert.deepEqual(
      sortProjects(rows, 'name', 'desc', lead).map((p) => p.id),
      ['c', 'a', 'b'],
    );
  });

  it('sorts by priority with "no priority" last', () => {
    assert.deepEqual(
      sortProjects(rows, 'priority', 'asc', lead).map((p) => p.id),
      ['c', 'b', 'a'],
    );
  });

  it('sorts by target date and lead name with missing values last', () => {
    assert.deepEqual(
      sortProjects(rows, 'targetDate', 'asc', lead).map((p) => p.id),
      ['c', 'b', 'a'],
    );
    assert.deepEqual(
      sortProjects(rows, 'lead', 'asc', lead).map((p) => p.id),
      ['c', 'a', 'b'],
    );
  });
});

describe('archivedProjects', () => {
  it('keeps the archived projects, most recently archived first', () => {
    const rows = [
      { id: 'a', archivedAt: null },
      { id: 'b', archivedAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c', archivedAt: '2026-11-10T00:00:00.000Z' },
    ];
    assert.deepEqual(
      archivedProjects(rows).map((p) => p.id),
      ['c', 'b'],
    );
  });
});
