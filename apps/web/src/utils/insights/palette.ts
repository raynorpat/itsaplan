import { statusOf, type InsightsState, type SliceField } from './slices';

// The colours the panel tells slices and segments apart with (DESIGN.md: categorical
// series use the widget's own hue palette, entity series the entity's own colour).
// Priority gets its own ramp of well-separated hues, since the field's priority tokens
// (urgent and high are both orange-red) cannot be told apart side by side in a stacked
// bar; a status uses its state's colour; the "none" slice (and No priority) is a light
// neutral that no hue is confused with.
const HUES = [
  'oklch(0.62 0.17 255)',
  'oklch(0.70 0.15 160)',
  'oklch(0.75 0.15 75)',
  'oklch(0.65 0.20 25)',
  'oklch(0.60 0.18 300)',
  'oklch(0.70 0.12 200)',
  'oklch(0.68 0.16 120)',
  'oklch(0.62 0.15 340)',
];

const PRIORITY: Record<string, string> = {
  '1': 'oklch(0.58 0.22 27)',
  '2': 'oklch(0.74 0.17 60)',
  '3': 'oklch(0.85 0.16 98)',
  '4': 'oklch(0.60 0.13 255)',
};

const NONE_COLOR = 'oklch(0.80 0.01 260)';

export function sliceColor(
  field: SliceField,
  key: string,
  index: number,
  states?: ReadonlyMap<string, InsightsState>,
): string {
  if (key === 'none') return NONE_COLOR;
  if (field === 'priority') return PRIORITY[key] ?? NONE_COLOR;
  const color = field === 'status' && states ? statusOf(key, states)?.color : undefined;
  if (color) return color;
  return HUES[index % HUES.length]!;
}
