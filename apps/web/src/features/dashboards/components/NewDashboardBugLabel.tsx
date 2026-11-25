import type { LabelChoice } from '../services/dashboardLabels.service';
import DashboardSelect from './DashboardSelect';

// The Bugs template's label: the labels named "Bug" when there are any, else a label
// the user picks.
export default function NewDashboardBugLabel({
  matched,
  labels,
  value,
  onChange,
}: {
  matched: LabelChoice[];
  labels: LabelChoice[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (matched.length > 0)
    return (
      <p className="text-xs text-muted-foreground">
        Bugs counts issues labeled{' '}
        {matched.map((l) => (l.teamKey ? `${l.name} (${l.teamKey})` : l.name)).join(', ')}.
      </p>
    );
  if (labels.length === 0)
    return (
      <p className="text-xs text-destructive">
        Bugs needs a label, and there are no labels yet. Create a “Bug” label first.
      </p>
    );
  return (
    <div className="grid gap-1.5 text-sm">
      <span>No label is named “Bug”. Which label marks bugs?</span>
      <DashboardSelect
        id="dashboard-bug-label"
        label="Bug label"
        value={value ?? 'none'}
        options={[
          { value: 'none', label: 'Pick a label' },
          ...labels.map((l) => ({
            value: l.id,
            label: l.teamKey ? `${l.name} (${l.teamKey})` : l.name,
          })),
        ]}
        onChange={(v) => v !== 'none' && onChange(v)}
        className="w-64"
      />
    </div>
  );
}
