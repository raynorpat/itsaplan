import type { SliceField } from './slices';

// The colours the panel tells slices and segments apart with. Priority uses the fixed
// priority hues; other fields cycle a small hue palette (DESIGN.md: widgets use their
// own palette for categorical series); the "none" slice is muted.
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
  '1': 'var(--priority-urgent)',
  '2': 'var(--priority-high)',
  '3': 'var(--priority-medium)',
  '4': 'var(--priority-low)',
};

const MUTED = 'var(--muted-foreground)';

export function sliceColor(field: SliceField, key: string, index: number): string {
  if (key === 'none') return MUTED;
  if (field === 'priority') return PRIORITY[key] ?? MUTED;
  return HUES[index % HUES.length]!;
}
