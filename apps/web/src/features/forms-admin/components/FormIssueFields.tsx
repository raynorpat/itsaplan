import { Input } from '@/components/ui/input';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import { useFormTeamScaffold } from '../hooks/useFormTeamScaffold';
import type { FormEditorState } from '../utils/formEditor';
import FormSettingField from './FormSettingField';
import FormTeamSelect from './FormTeamSelect';

// The form's name and what each new issue gets: team, status, labels and priority.
export default function FormIssueFields({
  form,
  errors,
  set,
  teamLocked,
}: {
  form: FormEditorState;
  errors: Record<string, string>;
  set: (patch: Partial<FormEditorState>) => void;
  teamLocked: boolean;
}) {
  const { states, labels, labelGroups } = useFormTeamScaffold(form.teamId);
  const toggleLabel = (id: string) =>
    set({
      labelIds: form.labelIds.includes(id)
        ? form.labelIds.filter((l) => l !== id)
        : [...form.labelIds, id],
    });

  return (
    <div className="grid gap-4">
      <FormSettingField id="form-name" label="Name" error={errors.name}>
        <Input id="form-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </FormSettingField>
      <FormSettingField
        id="form-team"
        label="New requests go to"
        hint={teamLocked ? 'The team cannot be changed once the form exists.' : undefined}
        error={errors.teamId}
      >
        <FormTeamSelect
          value={form.teamId}
          disabled={teamLocked}
          onChange={(teamId) => {
            // Statuses, labels and the questions' labels belong to the team.
            const fields = form.fields.map((f) => ({
              ...f,
              options: f.options?.map(({ labelId: _l, ...o }) => o),
            }));
            set({ teamId, stateId: '', labelIds: [], fields, boardIds: [] });
          }}
        />
      </FormSettingField>
      {form.teamId && (
        <FormSettingField
          id="form-issue"
          label="Each request gets"
          hint="Without a status, requests get the team's default status."
        >
          <div id="form-issue" className="flex flex-wrap items-center gap-1.5">
            <StatusSelect
              columns={states}
              value={form.stateId}
              onChange={(stateId) => set({ stateId })}
            />
            <LabelsSelect
              labels={labels}
              groups={labelGroups}
              value={form.labelIds}
              onToggle={toggleLabel}
            />
            <PrioritySelect value={form.priority} onChange={(priority) => set({ priority })} />
          </div>
        </FormSettingField>
      )}
    </div>
  );
}
