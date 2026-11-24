'use client';

import { useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useIssueSearchQuery } from '@/services/issues.service';

// Picks the issue a feedback item moves to, from a search of the team's active issues
// (the current issue is not offered). Moving to an issue the API refuses shows its
// message and changes nothing.
export default function FeedbackMoveDialog({
  teamKey,
  currentIssueId,
  pending,
  onPick,
  onClose,
}: {
  teamKey: string;
  currentIssueId: string;
  pending: boolean;
  onPick: (issueId: string) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const hits = useIssueSearchQuery(teamKey, term, { enabled: true }).data ?? [];
  const results = hits.filter((h) => !h.archived && h.id !== currentIssueId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">Move feedback to another issue</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Move feedback to…" value={term} onValueChange={setTerm} />
          <CommandList>
            {term.trim() && <CommandEmpty>No issues found.</CommandEmpty>}
            <CommandGroup>
              {results.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.id}
                  disabled={pending}
                  onSelect={() => onPick(r.id)}
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
