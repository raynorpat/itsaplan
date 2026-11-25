import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamsQuery } from '@/services/teams.service';

// A public team (a form's team must be public). Fixed once the form exists, since its
// status and labels belong to that team.
export default function FormTeamSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (teamId: string) => void;
  disabled: boolean;
}) {
  const teams = (useTeamsQuery().data ?? []).filter((t) => t.visibility === 'public');
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id="form-team" className="w-full sm:w-72">
        <SelectValue placeholder="Choose a team" />
      </SelectTrigger>
      <SelectContent>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
