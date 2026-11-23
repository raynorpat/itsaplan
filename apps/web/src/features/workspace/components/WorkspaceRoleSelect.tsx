'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MinimumRole } from '@/types/workspace';

const OPTIONS: { value: MinimumRole; label: string }[] = [
  { value: 'member', label: 'Members and up' },
  { value: 'admin', label: 'Admins and owners' },
  { value: 'owner', label: 'Owners only' },
];

// The minimum role for one workspace action.
export default function WorkspaceRoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: MinimumRole;
  disabled: boolean;
  onChange: (role: MinimumRole) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as MinimumRole)}>
      <SelectTrigger size="sm" className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
