import type { ActionDef, TeamDetail, Issue } from '@/lib/api';
import { matchesFilterSet } from '@/utils/filters';
import { describeEffect } from '@/utils/actions';
import { applicableLabels } from '@/utils/labels';
import { useDeleteIssue, useUpdateIssue } from '@/services/issues.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';

// The team's manual actions whose condition matches this issue, in saved
// order. Shared by the issue detail Actions block and the context menu.
// The issue patch an action applies. A labels effect replaces the issue's labels,
// so labels the web does not offer (workspace and retired labels applied over the
// API) are kept alongside the effect's labels.
function effectPatch(action: ActionDef, issue: Issue, team: TeamDetail) {
  const effect = action.effect;
  if (!effect.labelIds) return effect;
  const offered = new Set(applicableLabels(team.labels).map((l) => l.id));
  const kept = issue.labelIds.filter((id) => !offered.has(id));
  return { ...effect, labelIds: [...new Set([...effect.labelIds, ...kept])] };
}

export function matchedActions(actions: ActionDef[], team: TeamDetail, issue: Issue): ActionDef[] {
  return actions.filter((a) => matchesFilterSet(issue, a.condition, team));
}

// The confirm-dialog body for running an action: the changes it will apply, one
// per line.
function EffectSummary({ action, team }: { action: ActionDef; team: TeamDetail }) {
  const lines = describeEffect(action.effect, team);
  return (
    <div className="text-sm text-muted-foreground">
      <p>
        Apply <span className="font-medium text-foreground">{action.name}</span> to this issue?
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {lines.map((l) => (
            <li key={l.key} className="text-foreground">
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Confirm and run a issue delete. Owns the mutation; the caller owns whether the
// dialog is mounted and leaves the deleted issue via onDeleted. Shared by the
// issue detail Actions bar and the context menu.
export function DeleteIssueDialog({
  team,
  issue,
  onClose,
  onDeleted,
}: {
  team: TeamDetail;
  issue: Issue;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const deleteIssue = useDeleteIssue(team.team.key);
  return (
    <ConfirmDialog
      title="Delete issue"
      confirmLabel="Delete issue"
      onConfirm={async () => {
        await deleteIssue.mutateAsync(issue.id);
        onClose();
        onDeleted?.();
      }}
      onClose={onClose}
    >
      <p className="text-sm text-muted-foreground">
        Delete {issue.identifier}? This removes the issue, its comments, activity and attachments.
        This cannot be undone.
      </p>
    </ConfirmDialog>
  );
}

// Confirm and apply one manual action's effect as a single patch. Owns the
// mutation; the caller owns whether the dialog is mounted.
export function ApplyActionDialog({
  team,
  issue,
  action,
  onClose,
}: {
  team: TeamDetail;
  issue: Issue;
  action: ActionDef;
  onClose: () => void;
}) {
  const updateIssue = useUpdateIssue(team.team.key);
  return (
    <ConfirmDialog
      title={action.name}
      confirmLabel="Apply"
      onConfirm={async () => {
        await updateIssue.mutateAsync({ id: issue.id, patch: effectPatch(action, issue, team) });
        onClose();
      }}
      onClose={onClose}
    >
      <EffectSummary action={action} team={team} />
    </ConfirmDialog>
  );
}
