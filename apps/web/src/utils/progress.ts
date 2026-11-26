// A project's or cycle's progress (0–1) as a whole percent, rounded down. The API
// serves 0.999 while open issues remain, which stays below 100%.
export function progressPercent(progress: number): number {
  if (progress >= 1) return 100;
  return Math.min(99, Math.floor(progress * 100));
}
