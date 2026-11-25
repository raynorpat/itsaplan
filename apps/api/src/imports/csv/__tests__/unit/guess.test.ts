import { describe, expect, it } from 'bun:test';
import { guessColumns, guessStatusState, parsePriority } from '../../guess';

const states = [
  { id: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { id: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 'doing', name: 'In Progress', type: 'started', position: 2 },
  { id: 'done', name: 'Done', type: 'completed', position: 3 },
  { id: 'canceled', name: 'Canceled', type: 'canceled', position: 4 },
];

describe('guessStatusState', () => {
  it('matches a state name ignoring case', () => {
    expect(guessStatusState('in progress', states, 'todo')).toBe('doing');
  });

  it('matches by meaning', () => {
    expect(guessStatusState('Resolved', states, 'todo')).toBe('done');
    expect(guessStatusState("Won't do", states, 'todo')).toBe('canceled');
    expect(guessStatusState('In Review', states, 'todo')).toBe('doing');
  });

  it('falls back to the default state', () => {
    expect(guessStatusState('Parked', states, 'todo')).toBe('todo');
    expect(guessStatusState('', states, 'todo')).toBe('todo');
  });
});

describe('parsePriority', () => {
  it("reads Jira's priorities", () => {
    expect(parsePriority('Highest')).toBe(1);
    expect(parsePriority('High')).toBe(2);
    expect(parsePriority('Medium')).toBe(3);
    expect(parsePriority('Low')).toBe(4);
    expect(parsePriority('Lowest')).toBe(4);
  });

  it('reads Linear names and numbers, and gives null for anything else', () => {
    expect(parsePriority('urgent')).toBe(1);
    expect(parsePriority('No priority')).toBe(0);
    expect(parsePriority('2')).toBe(2);
    expect(parsePriority('')).toBe(0);
    expect(parsePriority('P9')).toBeNull();
  });
});

describe('guessColumns', () => {
  it('guesses fields from header names', () => {
    const headers = ['ID', 'Name', 'Notes', 'State', 'Owner', 'Tags', 'Created at', 'Story points'];
    expect(guessColumns(headers, [['7', 'A', '', 'Done', '', '', '25/12/2026', '3']])).toEqual({
      id: 0,
      title: 1,
      description: 2,
      status: 3,
      assignee: 4,
      labels: 5,
      createdAt: 6,
      estimate: 7,
      dateFormat: 'dayFirst',
    });
  });

  it('uses the first column as the title when no header names one', () => {
    expect(guessColumns(['Foo', 'Bar'], [])).toEqual({ title: 0, dateFormat: 'iso' });
  });
});
