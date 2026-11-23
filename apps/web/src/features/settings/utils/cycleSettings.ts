import type { TeamCycleSettings } from '@/types/team';

export type CycleSettingsForm = TeamCycleSettings;

// The ranges the API accepts (apps/api/src/cycles/store.ts), with the label the
// error names.
const RANGES = {
  duration: { min: 1, max: 8, label: 'Cycle length' },
  startDay: { min: 0, max: 6, label: 'Start day' },
  cooldown: { min: 0, max: 3, label: 'Cooldown' },
  upcomingCount: { min: 1, max: 10, label: 'Upcoming cycles' },
} as const;

export type CycleSettingsInput = {
  cyclesEnabled: boolean;
  cycleDuration: number;
  cycleStartDay: number;
  cycleCooldownTime: number;
  upcomingCycleCount: number;
  cycleIssueAutoAssignStarted: boolean;
  cycleIssueAutoAssignCompleted: boolean;
};

// The form as Linear's TeamUpdateInput cycle fields, or the first value out of range.
export function cycleSettingsInput(
  form: CycleSettingsForm,
): { ok: true; input: CycleSettingsInput } | { ok: false; error: string } {
  for (const [key, { min, max, label }] of Object.entries(RANGES)) {
    const value = form[key as keyof typeof RANGES];
    if (!Number.isInteger(value) || value < min || value > max)
      return { ok: false, error: `${label} must be a whole number from ${min} to ${max}` };
  }
  return {
    ok: true,
    input: {
      cyclesEnabled: form.enabled,
      cycleDuration: form.duration,
      cycleStartDay: form.startDay,
      cycleCooldownTime: form.cooldown,
      upcomingCycleCount: form.upcomingCount,
      cycleIssueAutoAssignStarted: form.autoAssignStarted,
      cycleIssueAutoAssignCompleted: form.autoAssignCompleted,
    },
  };
}
