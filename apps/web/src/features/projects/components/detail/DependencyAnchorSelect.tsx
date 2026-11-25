'use client';

import type { ProjectMilestone } from '@/types/project';
import type { AnchorType } from '@/utils/projectRelations';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface AnchorValue {
  anchorType: AnchorType;
  milestoneId: string | null;
}

// Where a dependency attaches to one project: its start, its end (target date) or
// one of its milestones. A milestone is offered only when the project has some.
export default function DependencyAnchorSelect({
  id,
  label,
  value,
  milestones,
  onChange,
}: {
  id: string;
  label: string;
  value: AnchorValue;
  milestones: ProjectMilestone[];
  onChange: (value: AnchorValue) => void;
}) {
  const selected = value.anchorType === 'milestone' ? `m:${value.milestoneId}` : value.anchorType;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={selected}
        onValueChange={(v) =>
          onChange(
            v.startsWith('m:')
              ? { anchorType: 'milestone', milestoneId: v.slice(2) }
              : { anchorType: v as AnchorType, milestoneId: null },
          )
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="start">Start</SelectItem>
          <SelectItem value="end">End</SelectItem>
          {milestones.map((m) => (
            <SelectItem key={m.id} value={`m:${m.id}`}>
              Milestone: {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
