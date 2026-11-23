import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cycleSettingsInput, type CycleSettingsForm } from '../cycleSettings';

// The cycle settings form becomes Linear's TeamUpdateInput cycle fields, within the
// ranges the API accepts: duration 1–8 weeks, start day 0–6 (Sunday–Saturday),
// cooldown 0–3 weeks, upcoming cycles 1–10.

const form: CycleSettingsForm = {
  enabled: true,
  duration: 2,
  startDay: 1,
  cooldown: 0,
  upcomingCount: 3,
  autoAssignStarted: true,
  autoAssignCompleted: false,
};

describe('cycleSettingsInput', () => {
  it('maps the form to TeamUpdateInput fields', () => {
    assert.deepEqual(cycleSettingsInput(form), {
      ok: true,
      input: {
        cyclesEnabled: true,
        cycleDuration: 2,
        cycleStartDay: 1,
        cycleCooldownTime: 0,
        upcomingCycleCount: 3,
        cycleIssueAutoAssignStarted: true,
        cycleIssueAutoAssignCompleted: false,
      },
    });
  });

  it('accepts the bounds of every range', () => {
    for (const patch of [
      { duration: 1 },
      { duration: 8 },
      { startDay: 0 },
      { startDay: 6 },
      { cooldown: 3 },
      { upcomingCount: 1 },
      { upcomingCount: 10 },
    ])
      assert.equal(cycleSettingsInput({ ...form, ...patch }).ok, true, JSON.stringify(patch));
  });

  it('rejects values outside the API ranges', () => {
    for (const patch of [
      { duration: 0 },
      { duration: 9 },
      { duration: 1.5 },
      { startDay: -1 },
      { startDay: 7 },
      { cooldown: -1 },
      { cooldown: 4 },
      { upcomingCount: 0 },
      { upcomingCount: 11 },
    ]) {
      const result = cycleSettingsInput({ ...form, ...patch });
      assert.equal(result.ok, false, JSON.stringify(patch));
    }
  });

  it('names the field in the error', () => {
    const result = cycleSettingsInput({ ...form, duration: 9 });
    assert.ok(!result.ok && /length/i.test(result.error));
  });
});
