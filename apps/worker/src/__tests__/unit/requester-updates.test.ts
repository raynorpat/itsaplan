import { describe, expect, it } from 'bun:test';
import { requesterJobsDue } from '../../requester-updates';

// When the worker asks the API to send requester change emails (every 2 minutes) and
// summaries (every 15 minutes).

const MINUTE = 60_000;

describe('requesterJobsDue', () => {
  it('runs both on the first tick', () => {
    expect(requesterJobsDue(0, { changes: null, summaries: null })).toEqual({
      changes: true,
      summaries: true,
    });
  });

  it('runs change emails 2 minutes after the last run', () => {
    const last = { changes: 0, summaries: 0 };
    expect(requesterJobsDue(2 * MINUTE - 1, last).changes).toBe(false);
    expect(requesterJobsDue(2 * MINUTE, last).changes).toBe(true);
  });

  it('runs summaries 15 minutes after the last run', () => {
    const last = { changes: 0, summaries: 0 };
    expect(requesterJobsDue(15 * MINUTE - 1, last).summaries).toBe(false);
    expect(requesterJobsDue(15 * MINUTE, last).summaries).toBe(true);
  });
});
