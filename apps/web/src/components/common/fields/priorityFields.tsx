import { type ReactNode } from 'react';
import { Minus, SignalHigh, SignalLow, SignalMedium, TriangleAlert } from 'lucide-react';
import { PRIORITIES } from '@/utils/fieldOptions';

// Accent icon per priority value (0 is "no priority").
const PRIORITY_ICON: Record<number, ReactNode> = {
  0: <Minus className="text-muted-foreground" />,
  1: <TriangleAlert style={{ color: 'var(--priority-urgent)' }} />,
  2: <SignalHigh style={{ color: 'var(--priority-high)' }} />,
  3: <SignalMedium style={{ color: 'var(--priority-medium)' }} />,
  4: <SignalLow style={{ color: 'var(--priority-low)' }} />,
};

// Priority selector rows: the "No priority" choice first, then the canonical
// priorities, each with its accent icon. Value is Linear's 0..4, 0 for none.
export const PRIORITY_FIELDS: { value: number; label: string; icon: ReactNode }[] = [
  { value: 0, label: 'No priority', icon: PRIORITY_ICON[0] },
  ...PRIORITIES.map((p) => ({ value: p.value, label: p.label, icon: PRIORITY_ICON[p.value] })),
];
