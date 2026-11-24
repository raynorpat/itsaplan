'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { settingsPath } from '@/utils/paths';
import { useEnableAutomation } from '../services/automations.service';
import { triggerSummary, type WorkflowRule } from '../utils/rules';
import AutomationRowMenu from './AutomationRowMenu';
import AutomationStats from './AutomationStats';

// One rule in the list: drag handle, name (opens the editor), trigger summary, run
// stats, the enabled switch and the options menu. Without edit rights the row is a
// read-only link. Archived rules are not sortable (`sortable` false).
export default function AutomationRow({
  rule,
  teamKey,
  canEdit,
  sortable,
}: {
  rule: WorkflowRule;
  teamKey: string;
  canEdit: boolean;
  sortable: boolean;
}) {
  const enable = useEnableAutomation(rule.teamId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    disabled: !sortable || !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const showHandle = sortable && canEdit;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex min-h-12 items-center gap-3 border-b border-border px-2 py-2 last:border-b-0 hover:bg-accent/50',
        isDragging && 'opacity-40',
        rule.archivedAt && 'text-muted-foreground',
      )}
    >
      {showHandle ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground/50 group-hover:text-muted-foreground"
          aria-label={`Drag to reorder ${rule.name}`}
          title="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={settingsPath(teamKey, `automations/${rule.id}`)}
          className="block truncate text-sm font-medium hover:underline"
        >
          {rule.name}
        </Link>
        <div className="truncate text-xs text-muted-foreground">{triggerSummary(rule)}</div>
        <AutomationStats rule={rule} />
      </div>
      {!rule.archivedAt && (
        <Switch
          checked={rule.enabled}
          disabled={!canEdit}
          aria-label={rule.enabled ? `Turn off ${rule.name}` : `Turn on ${rule.name}`}
          onCheckedChange={(enabled) => enable.mutate({ id: rule.id, enabled })}
        />
      )}
      {canEdit ? <AutomationRowMenu rule={rule} /> : <span className="size-5 shrink-0" />}
    </div>
  );
}
