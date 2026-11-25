import { describe, expect, it } from 'bun:test';
import { guessDateFormat, parseDate, parseJiraDate } from '../../dates';

describe('parseJiraDate', () => {
  it("reads Jira's export forms in UTC", () => {
    expect(parseJiraDate('25/Nov/26 10:15 AM')).toBe('2026-11-25T10:15:00.000Z');
    expect(parseJiraDate('25/Nov/2026 3:05 PM')).toBe('2026-11-25T15:05:00.000Z');
    expect(parseJiraDate('01/Dec/26 12:00 AM')).toBe('2026-12-01T00:00:00.000Z');
    expect(parseJiraDate('25/Nov/26')).toBe('2026-11-25T00:00:00.000Z');
    expect(parseJiraDate('2026-11-25T10:15:00')).toBe('2026-11-25T10:15:00.000Z');
  });

  it('gives null for empty or unreadable values', () => {
    expect(parseJiraDate('')).toBeNull();
    expect(parseJiraDate('soon')).toBeNull();
    expect(parseJiraDate('31/Feb/26')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads day-first and month-first values', () => {
    expect(parseDate('03/04/2026', 'dayFirst')).toBe('2026-04-03T00:00:00.000Z');
    expect(parseDate('03/04/2026', 'monthFirst')).toBe('2026-03-04T00:00:00.000Z');
    expect(parseDate('3.4.26 14:30', 'dayFirst')).toBe('2026-04-03T14:30:00.000Z');
  });

  it('reads ISO values whatever the format', () => {
    expect(parseDate('2026-04-03', 'monthFirst')).toBe('2026-04-03T00:00:00.000Z');
    expect(parseDate('2026-04-03 09:00', 'iso')).toBe('2026-04-03T09:00:00.000Z');
    expect(parseDate('2026-04-03T09:00:00Z', 'iso')).toBe('2026-04-03T09:00:00.000Z');
  });

  it('gives null for impossible dates', () => {
    expect(parseDate('13/13/2026', 'dayFirst')).toBeNull();
    expect(parseDate('03/04/2026', 'iso')).toBeNull();
    expect(parseDate('', 'iso')).toBeNull();
  });
});

describe('guessDateFormat', () => {
  it('guesses from the values', () => {
    expect(guessDateFormat(['2026-01-02', '2026-03-04'])).toBe('iso');
    expect(guessDateFormat(['03/04/2026', '25/12/2026'])).toBe('dayFirst');
    expect(guessDateFormat(['03/04/2026', '12/25/2026'])).toBe('monthFirst');
    expect(guessDateFormat([])).toBe('iso');
  });
});
