import { useState } from 'react';
import { toast } from 'sonner';
import type { TeamDetail } from '@/types/team';
import type { IssueDetail as IssueDetailRow } from '@/types/issue';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  useIssueSearchQuery,
  useSubIssuesQuery,
  useUpdateIssueDetail,
} from '@/services/issues.service';
import { parentCandidates } from '../../utils/subIssues';

// Picks the issue's parent from a search of the team's active issues. The issue itself
// and its sub-issues are not offered; a parent the API refuses (a deeper descendant)
// shows the API's message and changes nothing.
export default function SetParentDialog({
  team,
  issue,
  onClose,
}: {
  team: TeamDetail;
  issue: IssueDetailRow;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const childIds = (useSubIssuesQuery(issue.id).data?.children ?? []).map((c) => c.id);
  const hits = useIssueSearchQuery(team.team.key, term, { enabled: true }).data ?? [];
  const results = parentCandidates(
    hits.filter((h) => !h.archived),
    issue.id,
    childIds,
  );
  const update = useUpdateIssueDetail(team.team.key);

  function pick(parentId: string) {
    update.mutate(
      { id: issue.id, patch: { parentId } },
      {
        onSuccess: onClose,
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Set parent issue</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Set parent of ${issue.identifier}…`}
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {term.trim() && <CommandEmpty>No issues found.</CommandEmpty>}
            <CommandGroup>
              {results.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.id}
                  disabled={update.isPending}
                  onSelect={() => pick(r.id)}
                >
                  <span className="shrink-0 text-xs text-muted-foreground">{r.identifier}</span>
                  <span className="truncate">{r.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
