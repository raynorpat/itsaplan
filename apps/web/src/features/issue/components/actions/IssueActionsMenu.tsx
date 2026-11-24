import { Fragment, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  ClipboardCopy,
  CornerLeftUp,
  Link2,
  MoreHorizontal,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import type { IssueDetail as IssueDetailRow } from '@/types/issue';
import { useArchiveIssue, useRestoreIssue, useUpdateIssueDetail } from '@/services/issues.service';
import { usePermissions } from '@/hooks/usePermissions';
import { DeleteIssueDialog } from '@/components/common/issue/IssueActions';
import { buildIssuePrompt } from '@/utils/issuePrompt';
import { useSession } from '@/lib/auth-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { issueMenuItems, type IssueMenuItemId } from '../../utils/issueActions';
import SetParentDialog from '../subissues/SetParentDialog';

// The issue's ⋯ menu, as in Linear's issue header: copy link, copy prompt, set or
// remove the parent, archive or restore, delete. Owns the parent picker, the delete
// confirmation and the mutations it runs; the dialogs render through a portal, so
// where the menu sits does not matter.
export default function IssueActionsMenu({
  team,
  issue,
  onDeleted,
}: {
  team: TeamDetail;
  issue: IssueDetailRow;
  onDeleted?: () => void;
}) {
  const { can } = usePermissions();
  const { data: session } = useSession();
  const archiveIssue = useArchiveIssue(team.team.key);
  const restoreIssue = useRestoreIssue(team.team.key);
  const updateIssue = useUpdateIssueDetail(team.team.key);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [settingParent, setSettingParent] = useState(false);

  const items = issueMenuItems({
    canEdit: can('work_items', 'edit'),
    canDelete: can('work_items', 'delete'),
    archived: issue.archivedAt != null,
    hasParent: issue.parentId != null,
  });

  const showError = (err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed');

  function removeParent() {
    updateIssue.mutate({ id: issue.id, patch: { parentId: null } }, { onError: showError });
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildIssuePrompt(issue, team, session?.user));
    toast.success('Prompt copied');
  }

  // The issue's short identifier link (/IAP-62) redirects to the canonical page URL.
  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/${issue.identifier}`);
    toast.success('Short link copied');
  }

  const entries: Record<IssueMenuItemId, ReactNode> = {
    copyLink: (
      <DropdownMenuItem onSelect={copyLink}>
        <Link2 className="size-3.5" /> Copy link
      </DropdownMenuItem>
    ),
    copyPrompt: (
      <DropdownMenuItem onSelect={copyPrompt}>
        <ClipboardCopy className="size-3.5" /> Copy prompt
      </DropdownMenuItem>
    ),
    archive: (
      <DropdownMenuItem onSelect={() => archiveIssue.mutate(issue.id, { onError: showError })}>
        <Archive className="size-3.5" /> Archive
      </DropdownMenuItem>
    ),
    restore: (
      <DropdownMenuItem onSelect={() => restoreIssue.mutate(issue.id, { onError: showError })}>
        <ArchiveRestore className="size-3.5" /> Restore
      </DropdownMenuItem>
    ),
    delete: (
      <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
        <Trash2 className="size-3.5" /> Delete
      </DropdownMenuItem>
    ),
    setParent: (
      <DropdownMenuItem onSelect={() => setSettingParent(true)}>
        <CornerLeftUp className="size-3.5" /> Set parent…
      </DropdownMenuItem>
    ),
    removeParent: (
      <DropdownMenuItem onSelect={removeParent}>
        <Unlink className="size-3.5" /> Remove parent
      </DropdownMenuItem>
    ),
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Issue actions"
          title="Issue actions"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {items.map((id) => (
            <Fragment key={id}>
              {id === 'delete' && <DropdownMenuSeparator />}
              {entries[id]}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {settingParent && (
        <SetParentDialog team={team} issue={issue} onClose={() => setSettingParent(false)} />
      )}

      {confirmingDelete && (
        <DeleteIssueDialog
          team={team}
          issue={issue}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
