'use client';

import { X } from 'lucide-react';
import type { FilterCondition } from '@/utils/filters';
import { useLabelChoices } from '../services/dashboardLabels.service';
import { conditionChips } from '../utils/filterChips';

// The conditions of an "All teams" widget besides the team (a template's label or
// state type condition), each removable.
export default function WidgetFilterChips({
  conditions,
  onRemove,
}: {
  conditions: FilterCondition[];
  onRemove: (id: string) => void;
}) {
  const hasLabels = conditions.some((c) => c.field === 'labels');
  const labels = useLabelChoices(hasLabels).data ?? [];
  const chips = conditionChips(conditions, new Map(labels.map((l) => [l.id, l.name])));
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Filter">
      {chips.map((chip) => (
        <li
          key={chip.id}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
        >
          {chip.text}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${chip.text}`}
            onClick={() => onRemove(chip.id)}
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
