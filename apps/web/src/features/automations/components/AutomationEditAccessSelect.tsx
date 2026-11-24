import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EditAccess } from '../utils/rules';

const OPTIONS: { value: EditAccess; label: string }[] = [
  { value: 'everyone', label: 'Everyone in the team' },
  { value: 'teamOwners', label: 'Team owners and workspace admins' },
  { value: 'workspaceAdmins', label: 'Workspace admins' },
  { value: 'owner', label: 'Only its owner and workspace admins' },
];

// Who may change the automation. Only team owners and workspace admins change this
// (the API's assertMayManageAccess); others see it disabled.
export default function AutomationEditAccessSelect({
  value,
  onChange,
  disabled,
}: {
  value: EditAccess;
  onChange: (access: EditAccess) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EditAccess)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 w-96 max-w-full" aria-label="Who can edit">
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
