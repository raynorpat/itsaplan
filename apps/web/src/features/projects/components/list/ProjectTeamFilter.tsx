'use client';

import { useTeamsQuery } from '@/services/teams.service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

// The Projects area's team filter: every team, or one team the user belongs to.
// Teams that turned the Projects section off are not offered.
export default function ProjectTeamFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (teamKey: string | null) => void;
}) {
  const teams = useTeamsQuery().data ?? [];
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className="h-8 w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All teams</SelectItem>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.key}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
