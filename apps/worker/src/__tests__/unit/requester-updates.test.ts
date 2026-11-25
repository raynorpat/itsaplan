import { describe, expect, it } from 'bun:test';
import { requesterJobsDue, runRequesterUpdates } from '../../requester-updates';

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

describe('runRequesterUpdates', () => {
  it('returns at once and skips a job whose last run is still going', async () => {
    const calls: string[] = [];
    let finish = () => {};
    const slow = (path: string) => {
      calls.push(path);
      if (path.endsWith('summaries')) return Promise.resolve(0);
      return new Promise<number>((resolve) => {
        finish = () => resolve(0);
      });
    };
    const first = runRequesterUpdates(0, slow);
    expect(first).toHaveLength(2);
    // Two minutes on, the change run is still going: it is not started again.
    expect(runRequesterUpdates(2 * MINUTE, slow)).toHaveLength(0);
    finish();
    await Promise.all(first);
    expect(runRequesterUpdates(4 * MINUTE, slow)).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('changes'))).toHaveLength(2);
  });
});
