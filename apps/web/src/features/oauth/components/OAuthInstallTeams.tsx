'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTeamsQuery } from '@/services/teams.service';
import type { InstallSelection } from '../utils/consent';

// The teams an application installed as an app may use: every public team (and the
// ones created later), plus any teams picked here. Private teams are reached only by
// picking them.
export default function OAuthInstallTeams({
  value,
  onChange,
  disabled,
}: {
  value: InstallSelection;
  onChange: (next: InstallSelection) => void;
  disabled?: boolean;
}) {
  const { data: teams, isPending } = useTeamsQuery();
  const pickable = (teams ?? []).filter(
    (team) => !value.publicTeams || team.visibility === 'private',
  );
  const toggle = (teamId: string, checked: boolean) =>
    onChange({
      ...value,
      teamIds: checked ? [...value.teamIds, teamId] : value.teamIds.filter((id) => id !== teamId),
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="oauth-public-teams"
          checked={value.publicTeams}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              publicTeams: checked === true,
              // Picked public teams are covered by "every public team".
              teamIds:
                checked === true
                  ? value.teamIds.filter(
                      (id) => teams?.find((t) => t.id === id)?.visibility === 'private',
                    )
                  : value.teamIds,
            })
          }
        />
        <Label htmlFor="oauth-public-teams" className="font-normal">
          Every public team, including new ones
        </Label>
      </div>
      {isPending && <p className="text-sm text-muted-foreground">Loading teams…</p>}
      {pickable.map((team) => (
        <div key={team.id} className="flex items-center gap-2">
          <Checkbox
            id={`oauth-team-${team.id}`}
            checked={value.teamIds.includes(team.id)}
            disabled={disabled}
            onCheckedChange={(checked) => toggle(team.id, checked === true)}
          />
          <Label htmlFor={`oauth-team-${team.id}`} className="font-normal">
            {team.name}
            <span className="ml-1 text-xs text-muted-foreground">
              {team.key}
              {team.visibility === 'private' && ' · private'}
            </span>
          </Label>
        </div>
      ))}
    </div>
  );
}
