'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { useWorkspaceUsersQuery } from '@/services/members.service';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSaveAutomation } from '../services/automations.service';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import {
  formDirty,
  formToRuleInput,
  ruleToForm,
  ruleUpdatePatch,
  takesOwnership,
  type RuleForm,
} from '../utils/ruleForm';
import { normalizeRule, ownerName, type WorkflowRule } from '../utils/rules';
import AutomationEditorSection from './AutomationEditorSection';
import AutomationTriggerSelect from './AutomationTriggerSelect';
import AutomationConditions from './AutomationConditions';
import AutomationActions from './AutomationActions';
import AutomationEditAccessSelect from './AutomationEditAccessSelect';

// The editor's form: name, When, If, Then and edit access. Save sends only what
// changed since the form was opened (ruleUpdatePatch against `base`, the rule the form
// was built from) and returns to the list; a refusal shows the API's message above the
// buttons. When the server copy changes meanwhile (another editor), a notice offers to
// reload it. Read-only when `editable` is false.
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
  const viewerId = useSession().data?.user.id ?? '';
  const save = useSaveAutomation(team.team.id);
  const [base, setBase] = useState<WorkflowRule | null>(rule);
  const [form, setForm] = useState<RuleForm>(() => ruleToForm(rule));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));

  const dirty = editable && formDirty(form, base);
  useUnsavedChangesGuard(dirty && !save.isPending && !save.isSuccess);
  const changedElsewhere = rule != null && base != null && rule.updatedAt !== base.updatedAt;
  const reload = () => {
    setBase(rule);
    setForm(ruleToForm(rule));
    setError(null);
  };

  const owner = useOwnerName(team, base?.ownerId ?? null);
  const result = formToRuleInput(form, team.team.id);
  const patch = base && 'input' in result ? ruleUpdatePatch(result.input, base) : null;
  const becomesOwner = patch != null && takesOwnership(patch, base, viewerId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    if ('error' in result) return setError(result.error);
    setError(null);
    save.mutate(
      { id: base?.id ?? null, input: patch ?? result.input },
      {
        onSuccess: ({ workflow }) => {
          setBase(normalizeRule(workflow));
          router.push(listHref);
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Saving failed'),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
      {changedElsewhere && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>This automation was changed by someone else.</span>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            Reload
          </Button>
        </div>
      )}
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
        {base && <p className="text-xs text-muted-foreground">Owner: {owner ?? 'no one'}</p>}
      </AutomationEditorSection>

      {editable && becomesOwner && (
        <p className="text-sm text-muted-foreground">
          Saving makes you the owner of this automation.
        </p>
      )}
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

// The rule owner's name: a team member, else a workspace user (guests cannot list
// workspace users and see only the team's members).
function useOwnerName(team: TeamDetail, ownerId: string | null): string | null {
  const known = team.assignees.some((a) => a.userId === ownerId);
  const isGuest = team.viewer.workspaceRole === 'guest';
  const users = useWorkspaceUsersQuery(ownerId != null && !known && !isGuest).data ?? [];
  return ownerName(ownerId, [...team.assignees, ...users]);
}
