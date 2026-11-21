import { describe, expect, it } from 'bun:test';
import { nextStatusTimestamps } from '../../status-timestamps';

const now = new Date('2026-05-01T10:00:00Z');
const earlier = new Date('2026-04-01T10:00:00Z');
const none = { startedAt: null, completedAt: null, canceledAt: null };

describe('nextStatusTimestamps', () => {
  it('sets startedAt when entering a started column for the first time', () => {
    expect(nextStatusTimestamps(none, 'started', now)).toEqual({ ...none, startedAt: now });
  });

  it('keeps an existing startedAt when entering a started column again', () => {
    const prev = { ...none, startedAt: earlier };
    expect(nextStatusTimestamps(prev, 'started', now).startedAt).toBe(earlier);
  });

  it('sets completedAt and keeps startedAt when completing', () => {
    const prev = { ...none, startedAt: earlier };
    expect(nextStatusTimestamps(prev, 'completed', now)).toEqual({
      startedAt: earlier,
      completedAt: now,
      canceledAt: null,
    });
  });

  it('clears completedAt when moving from completed back to started', () => {
    const prev = { startedAt: earlier, completedAt: earlier, canceledAt: null };
    expect(nextStatusTimestamps(prev, 'started', now)).toEqual({
      startedAt: earlier,
      completedAt: null,
      canceledAt: null,
    });
  });

  it('sets canceledAt when canceling', () => {
    expect(nextStatusTimestamps(none, 'canceled', now)).toEqual({ ...none, canceledAt: now });
  });

  it('clears canceledAt and sets completedAt when moving from canceled to completed', () => {
    const prev = { ...none, canceledAt: earlier };
    expect(nextStatusTimestamps(prev, 'completed', now)).toEqual({
      startedAt: null,
      completedAt: now,
      canceledAt: null,
    });
  });

  it('clears all three when moving to backlog or unstarted', () => {
    const prev = { startedAt: earlier, completedAt: earlier, canceledAt: earlier };
    expect(nextStatusTimestamps(prev, 'backlog', now)).toEqual(none);
    expect(nextStatusTimestamps(prev, 'unstarted', now)).toEqual(none);
  });
});
