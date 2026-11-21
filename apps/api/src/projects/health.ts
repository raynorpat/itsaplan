// Project health is not stored — it is computed on the fly from the
// project's issue progress against its timeline. The idea: compare how much
// work is done (share of completed issues) with how much of the timeline has
// elapsed. Being ahead of, or level with, the schedule is onTrack; falling
// behind is atRisk, then offTrack.

export type Health = 'onTrack' | 'atRisk' | 'offTrack';

// gap = progress - elapsed (both 0..1). A gap at or above `atRisk` is onTrack;
// between `offTrack` and `atRisk` is atRisk; below `offTrack` is offTrack.
const HEALTH_THRESHOLDS = {
  atRisk: -0.1,
  offTrack: -0.25,
} as const;

export interface HealthInput {
  completed: number; // issues in a 'completed' state
  total: number; // all issues linked to the project
  canceled: number; // issues in a 'canceled' state (excluded from progress)
  startDate: string | null; // 'YYYY-MM-DD'; falls back to createdAt
  targetDate: string | null; // 'YYYY-MM-DD'
  createdAt: string; // ISO timestamp
  now?: Date; // injectable for tests; defaults to the current time
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Returns null when there is nothing meaningful to judge: no active work
// (denominator zero) or no target date to measure progress against.
export function computeHealth(input: HealthInput): Health | null {
  const denom = input.total - input.canceled;
  if (denom <= 0) return null; // no active issues yet
  const progress = clamp01(input.completed / denom);
  if (progress >= 1) return 'onTrack'; // everything closed

  if (!input.targetDate) return null; // no timeline to judge against
  const now = input.now ?? new Date();
  const target = new Date(input.targetDate);
  // Target reached and not everything is done → behind schedule.
  if (now.getTime() >= target.getTime()) return 'offTrack';

  const start = input.startDate ? new Date(input.startDate) : new Date(input.createdAt);
  const span = target.getTime() - start.getTime();
  const elapsed = span <= 0 ? 1 : clamp01((now.getTime() - start.getTime()) / span);

  const gap = progress - elapsed;
  if (gap >= HEALTH_THRESHOLDS.atRisk) return 'onTrack';
  if (gap >= HEALTH_THRESHOLDS.offTrack) return 'atRisk';
  return 'offTrack';
}
