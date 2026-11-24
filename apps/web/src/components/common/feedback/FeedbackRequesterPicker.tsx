'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useRequesterSearchQuery } from '@/services/feedback.service';
import type { FeedbackRequester } from '@/utils/feedback';

// Finds the person who gave the feedback by name or email, or starts a new person with
// the typed text as their name.
export default function FeedbackRequesterPicker({
  onPick,
  onNew,
}: {
  onPick: (requester: FeedbackRequester) => void;
  onNew: (typed: string) => void;
}) {
  const [term, setTerm] = useState('');
  const results = useRequesterSearchQuery(term, { enabled: true }).data ?? [];

  return (
    <Command shouldFilter={false} className="rounded-md border">
      <CommandInput
        placeholder="Search people by name or email…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        {term.trim() && results.length === 0 && <CommandEmpty>No one found.</CommandEmpty>}
        <CommandGroup>
          {results.map((r) => (
            <CommandItem key={r.id} value={r.id} onSelect={() => onPick(r)}>
              <Avatar name={r.name} image={r.avatarUrl} />
              <span className="truncate">{r.name}</span>
              {r.email && <span className="truncate text-xs text-muted-foreground">{r.email}</span>}
            </CommandItem>
          ))}
          <CommandItem value="__new" onSelect={() => onNew(term.trim())}>
            <UserPlus className="size-4" />
            {term.trim() ? `New person “${term.trim()}”` : 'New person'}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
