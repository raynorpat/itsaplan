import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useImportTeamStatesQuery } from '../services/csvImport.service';
import { AUTO_STATE, statusOptions } from '../utils/csvImport';

// The statuses step of a CSV import: each status value found in the file with the
// destination team's state it becomes. "Automatic" leaves it to the API's guess (by
// name, then by meaning, else the team's default state). An import into a new team
// offers the states every new team starts with.
export default function ImportStatusFields({
  teamId,
  statuses,
  chosen,
  onChange,
}: {
  teamId: string | null;
  statuses: string[];
  chosen: Record<string, string>;
  onChange: (chosen: Record<string, string>) => void;
}) {
  const { data: states, isPending } = useImportTeamStatesQuery(teamId);
  const options = statusOptions(teamId ? (states ?? []) : null);
  if (statuses.length === 0) return null;
  return (
    <section aria-labelledby="import-statuses" className="grid gap-1">
      <h3 id="import-statuses" className="text-sm font-medium">
        Statuses
      </h3>
      {teamId && isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {statuses.map((status) => (
            <li key={status} className="flex items-center justify-between gap-4 py-2">
              <span className="min-w-0 truncate text-sm">{status}</span>
              <Select
                value={chosen[status] ?? AUTO_STATE}
                onValueChange={(v) => onChange({ ...chosen, [status]: v })}
              >
                <SelectTrigger aria-label={`State for ${status}`} className="w-48 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_STATE}>Automatic</SelectItem>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
