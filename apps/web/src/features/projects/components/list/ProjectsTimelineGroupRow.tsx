import { ChevronDown, ChevronRight } from 'lucide-react';
import { GROUP_H } from '@/utils/timelineScale';

// A group header on the projects timeline: its name and project count; a click
// collapses or expands its rows.
export default function ProjectsTimelineGroupRow({
  label,
  count,
  collapsed,
  labelW,
  trackWidth,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  labelW: number;
  trackWidth: number;
  onToggle: () => void;
}) {
  return (
    <div className="flex border-b bg-muted/40" style={{ height: GROUP_H }}>
      <button
        type="button"
        title={collapsed ? 'Expand group' : 'Collapse group'}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 overflow-hidden border-r bg-muted/40 px-3 text-left text-sm font-medium"
        style={{ width: labelW }}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-muted-foreground">{count}</span>
      </button>
      <div style={{ width: trackWidth }} />
    </div>
  );
}
