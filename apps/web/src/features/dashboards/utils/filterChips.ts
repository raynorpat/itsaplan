import { PRIORITY_OPTIONS, STATE_TYPE_OPTIONS } from '@/utils/fieldOptions';
import { OPERATOR_LABELS } from '@/utils/filterFields';
import type { FilterCondition } from '@/utils/filters';

// An issues or requests widget's filter outside the team picker: changing the team
// keeps the other conditions, and with "All teams" those conditions are listed as
// chips (a template's label or state type condition holds on every team).

// The conditions with the widget's team set to `teamId` (none for all teams).
export function withTeam(conditions: FilterCondition[], teamId: string | null): FilterCondition[] {
  const rest = conditions.filter((c) => c.field !== 'team');
  if (!teamId) return rest;
  return [{ id: crypto.randomUUID(), field: 'team', op: 'is', values: [teamId] }, ...rest];
}

const FIELD_LABELS: Record<string, string> = {
  status: 'State',
  statusType: 'State type',
  assignee: 'Assignee',
  creator: 'Creator',
  priority: 'Priority',
  labels: 'Labels',
  project: 'Project',
  cycle: 'Cycle',
};

const NAMED = new Map<string, string>([
  ...STATE_TYPE_OPTIONS.map((o) => [o.value, o.label] as const),
  ...PRIORITY_OPTIONS.map((o) => [String(o.value), o.label] as const),
]);

// One line per condition besides the team: field, operator and the values by name
// (`names` for labels and other ids), or how many values when one has no name.
export function conditionChips(
  conditions: FilterCondition[],
  names: ReadonlyMap<string, string>,
): { id: string; text: string }[] {
  return conditions
    .filter((c) => c.field !== 'team')
    .map((c) => {
      const labels = c.values.map((v) => names.get(String(v)) ?? NAMED.get(String(v)));
      const values = labels.every((l): l is string => l !== undefined)
        ? labels.join(', ')
        : `${c.values.length} values`;
      const field = FIELD_LABELS[c.field] ?? c.field;
      const op = OPERATOR_LABELS[c.op];
      return { id: c.id, text: `${field} ${op} ${values}` };
    });
}
