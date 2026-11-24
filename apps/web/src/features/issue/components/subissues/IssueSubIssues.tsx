import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ListTree, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { StateType, TeamDetail } from '@/types/team';
import Avatar from '@/components/common/Avatar';
import { PriorityIcon, StateIcon } from '@/components/common/issue/IssueIcons';
import { useCreateIssue, useSubIssuesQuery } from '@/services/issues.service';
import { issuePathFromIdentifier } from '@/utils/issueNavigation';
import { sortSubIssues, subIssueInput, subIssueProgress } from '../../utils/subIssues';

// The issue's sub-issues, as in Linear: a "Sub-issues 2/5" header, one compact row per
// sub-issue opening its page, and an inline "+ Add sub-issue" for someone who can edit
// (Enter creates it in the team's first state, Escape cancels).
export default function IssueSubIssues({
  team,
  issueId,
  canEdit,
}: {
  team: TeamDetail;
  issueId: string;
  canEdit: boolean;
}) {
  const family = useSubIssuesQuery(issueId).data;
  const children = useMemo(() => sortSubIssues(family?.children ?? []), [family]);
  const createIssue = useCreateIssue();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  if (children.length === 0 && !canEdit) return null;

  const { done, total } = subIssueProgress(children);

  function submit() {
    const input = subIssueInput(title, team, issueId);
    // A second Enter while the first create is saving would add the sub-issue twice.
    if (!input || createIssue.isPending) return;
    createIssue.mutate(
      { teamKey: team.team.key, input },
      {
        onSuccess: () => setTitle(''),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
      },
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListTree className="size-3.5" />
          Sub-issues
          {total > 0 && (
            <span className="tabular-nums" aria-label={`${done} of ${total} done`}>
              {done}/{total}
            </span>
          )}
        </h3>
        {canEdit && !adding && (
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" />
            Add sub-issue
          </button>
        )}
      </div>

      {children.length > 0 && (
        <ul className="flex flex-col">
          {children.map((c) => (
            <li key={c.id}>
              <Link
                href={issuePathFromIdentifier(c.identifier)}
                className="flex h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent/50"
              >
                <PriorityIcon priority={c.priority} className="shrink-0" />
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{c.identifier}</span>
                <StateIcon
                  stateType={c.state.type as StateType}
                  color={c.state.color}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.assignee && (
                  <Avatar
                    name={c.assignee.name}
                    image={c.assignee.avatarUrl}
                    className="size-5 shrink-0"
                    title={c.assignee.name}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <input
          autoFocus
          aria-label="Sub-issue title"
          placeholder="Sub-issue title"
          className="mt-1 h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={title}
          // readOnly, not disabled: a disabled input loses focus, and the next
          // Escape would then leave the issue instead of closing the input.
          readOnly={createIssue.isPending}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              // Handled here, so the page or panel behind does not also close.
              e.preventDefault();
              e.stopPropagation();
              setAdding(false);
              setTitle('');
            }
          }}
          onBlur={() => {
            if (!title.trim()) setAdding(false);
          }}
        />
      )}
    </div>
  );
}
