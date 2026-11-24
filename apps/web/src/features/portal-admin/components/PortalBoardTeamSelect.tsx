import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamsQuery } from '@/services/teams.service';

// A public team (a board never shows a private team's issues).
export default function PortalBoardTeamSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (teamId: string) => void;
}) {
  const teams = (useTeamsQuery().data ?? []).filter((t) => t.visibility === 'public');
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full sm:w-72">
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
