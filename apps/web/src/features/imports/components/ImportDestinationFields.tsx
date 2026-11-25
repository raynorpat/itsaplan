import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeamsQuery } from '@/services/teams.service';
import { NEW_TEAM, type DestinationForm } from '../utils/imports';

// The team an import goes into (an existing team or a new one by name), whether closed
// issues come too, and the optional source label filter. `teamOnly` (a CSV file, which
// is imported whole) shows the team alone.
export default function ImportDestinationFields({
  value,
  onChange,
  teamOnly = false,
}: {
  value: DestinationForm;
  onChange: (value: DestinationForm) => void;
  teamOnly?: boolean;
}) {
  const teams = useTeamsQuery().data ?? [];
  const set = (patch: Partial<DestinationForm>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="import-team">Team</Label>
        <Select value={value.team} onValueChange={(team) => set({ team })}>
          <SelectTrigger id="import-team" className="w-full sm:w-72">
            <SelectValue placeholder="Choose a team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
            <SelectItem value={NEW_TEAM}>New team…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {value.team === NEW_TEAM && (
        <div className="grid gap-1.5">
          <Label htmlFor="import-team-name">New team name</Label>
          <Input
            id="import-team-name"
            className="sm:w-72"
            value={value.newTeamName}
            onChange={(e) => set({ newTeamName: e.target.value })}
          />
        </div>
      )}
      {!teamOnly && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="import-labels">Only issues with these labels</Label>
            <Input
              id="import-labels"
              className="sm:w-72"
              placeholder="bug, enhancement"
              value={value.labels}
              onChange={(e) => set({ labels: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Leave empty to import every issue.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="import-closed"
              checked={value.includeClosed}
              onCheckedChange={(v) => set({ includeClosed: v === true })}
            />
            <Label htmlFor="import-closed">Include closed issues</Label>
          </div>
        </>
      )}
    </div>
  );
}
