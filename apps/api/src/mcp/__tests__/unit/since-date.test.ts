import { describe, expect, it } from 'bun:test';
import { sinceDate } from '../../tools/issues';

// list_issues' completedAt: an ISO-8601 date as given, or a duration counted back.
describe('sinceDate', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');

  it('counts a duration back from now', () => {
    expect(sinceDate('-P7D', now)).toBe('2026-11-17T12:00:00.000Z');
    expect(sinceDate('P2W', now)).toBe('2026-11-10T12:00:00.000Z');
    expect(sinceDate('-PT12H', now)).toBe('2026-11-24T00:00:00.000Z');
    expect(sinceDate('-P1M', now)).toBe('2026-10-24T12:00:00.000Z');
  });

  it('takes a date as given and refuses anything else', () => {
    expect(sinceDate('2026-11-01', now)).toBe('2026-11-01T00:00:00.000Z');
    expect(() => sinceDate('last week', now)).toThrow('neither an ISO-8601 date nor a duration');
    expect(() => sinceDate('-P', now)).toThrow();
  });
});
