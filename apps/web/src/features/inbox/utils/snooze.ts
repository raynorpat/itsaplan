// The snooze presets: tomorrow, or in a week, at 09:00 local time.
export function snoozePreset(preset: 'tomorrow' | 'week', from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + (preset === 'tomorrow' ? 1 : 7));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
