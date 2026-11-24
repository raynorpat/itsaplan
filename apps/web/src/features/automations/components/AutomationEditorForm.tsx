'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSaveAutomation } from '../services/automations.service';
import { formToRuleInput, ruleToForm, ruleUpdatePatch, type RuleForm } from '../utils/ruleForm';
import type { WorkflowRule } from '../utils/rules';
import AutomationEditorSection from './AutomationEditorSection';
import AutomationTriggerSelect from './AutomationTriggerSelect';
import AutomationConditions from './AutomationConditions';
import AutomationActions from './AutomationActions';
import AutomationEditAccessSelect from './AutomationEditAccessSelect';

// The editor's form: name, When, If, Then and edit access. Save sends only what the
// API needs (ruleUpdatePatch) and returns to the list; a refusal shows the API's
// message above the buttons. Read-only when `editable` is false.
export default function AutomationEditorForm({
  team,
  rule,
  editable,
  managesAccess,
  listHref,
}: {
  team: TeamDetail;
  rule: WorkflowRule | null;
  editable: boolean;
  managesAccess: boolean;
  listHref: string;
}) {
  const router = useRouter();
  const save = useSaveAutomation(team.team.id);
  const [form, setForm] = useState<RuleForm>(() => ruleToForm(rule));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const result = formToRuleInput(form, team.team.id);
    if ('error' in result) return setError(result.error);
    setError(null);
    const input = rule ? ruleUpdatePatch(result.input, rule) : result.input;
    save.mutate(
      { id: rule?.id ?? null, input },
      {
        onSuccess: () => router.push(listHref),
        onError: (err) => setError(err instanceof Error ? err.message : 'Saving failed'),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
      <AutomationEditorSection label="Name">
        <Input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Automation name"
          aria-label="Name"
          readOnly={!editable}
          autoFocus={!rule && editable}
        />
        <Textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Description (optional)"
          aria-label="Description"
          readOnly={!editable}
          rows={2}
        />
      </AutomationEditorSection>

      <AutomationEditorSection label="When">
        <AutomationTriggerSelect
          value={form.trigger}
          onChange={(trigger) => set({ trigger })}
          disabled={!editable}
        />
      </AutomationEditorSection>

      <AutomationEditorSection label="If">
        <AutomationConditions form={form} team={team} editable={editable} onChange={set} />
      </AutomationEditorSection>

      <AutomationEditorSection label="Then">
        <AutomationActions
          actions={form.actions}
          team={team}
          editable={editable}
          onChange={(actions) => set({ actions })}
        />
      </AutomationEditorSection>

      <AutomationEditorSection label="Who can edit">
        <AutomationEditAccessSelect
          value={form.editAccess}
          onChange={(editAccess) => set({ editAccess })}
          disabled={!editable || !managesAccess}
        />
      </AutomationEditorSection>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {editable && (
          <Button type="submit" size="sm" disabled={save.isPending}>
            {rule ? 'Save' : 'Create automation'}
          </Button>
        )}
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href={listHref}>{editable ? 'Cancel' : 'Back'}</Link>
        </Button>
      </div>
    </form>
  );
}
