'use client';

import type { Team } from '@/lib/api';
import { Checkbox } from '@/components/ui/checkbox';

// A checkbox per team, for choosing the teams a project belongs to. Every team the
// user can see is offered: seeing a team is enough to add its projects.
export default function ProjectTeamsChecklist({
  teams,
  value,
  onChange,
}: {
  teams: Team[];
  value: string[];
  onChange: (teamIds: string[]) => void;
}) {
  const allowed = teams;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((x) => x !== id));
  return (
    <div className="flex flex-col gap-2">
      {allowed.map((t) => (
        <label key={t.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(t.id)}
            onCheckedChange={(c) => toggle(t.id, c === true)}
          />
          <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
          {t.name}
        </label>
      ))}
    </div>
  );
}
