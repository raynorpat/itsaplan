import { describe, expect, it } from 'bun:test';
import { emailActor } from '../../outbound';

describe('emailActor', () => {
  it('names a person as is', () => {
    expect(emailActor('Pat', false)).toBe('Pat');
  });

  it('marks a workflow, as the inbox does', () => {
    expect(emailActor('Triage bot', true)).toBe('Triage bot (workflow)');
  });

  it('falls back to Someone without a name', () => {
    expect(emailActor(null, false)).toBe('Someone');
    expect(emailActor('', false)).toBe('Someone');
  });
});
