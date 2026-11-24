import FilterBar from '@/components/layout/FilterBar';
import type { TeamDetail } from '@/types/team';
import { conditionsHidden, type RuleForm } from '../utils/ruleForm';

// The If part: the views filter bar. Empty matches every issue (allowed only for the
// created trigger). Conditions the filter bar cannot show are kept until the filters
// are changed, and a note says so.
export default function AutomationConditions({
  form,
  team,
  editable,
  onChange,
}: {
  form: RuleForm;
  team: TeamDetail;
  editable: boolean;
  onChange: (patch: Partial<RuleForm>) => void;
}) {
  const hidden = !form.filtersEdited && conditionsHidden(form.rawConditions);
  return (
    <div className="flex flex-col gap-1.5">
      <div inert={!editable} className={editable ? undefined : 'opacity-70'}>
        <FilterBar
          filters={form.filters}
          team={team}
          onChange={(filters) => onChange({ filters, filtersEdited: true })}
        />
      </div>
      {form.filters.conditions.length === 0 && !hidden && (
        <p className="text-xs text-muted-foreground">
          {form.trigger === 'entityCreated'
            ? 'No conditions: runs on every new issue.'
            : 'Add at least one condition.'}
        </p>
      )}
      {hidden && (
        <p className="text-xs text-muted-foreground">
          Some conditions were set outside this page and are not shown. They are kept unless you
          change the conditions here.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        “Me” in a condition is the automation’s owner, the person who last changed its conditions or
        actions.
      </p>
    </div>
  );
}
