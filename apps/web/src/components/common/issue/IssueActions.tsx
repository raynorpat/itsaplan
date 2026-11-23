import type { TeamDetail, Issue } from '@/lib/api';
import { useDeleteIssue } from '@/services/issues.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';

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
