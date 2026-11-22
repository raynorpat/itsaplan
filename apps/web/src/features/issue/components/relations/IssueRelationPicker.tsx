import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRelationSearchQuery, type NewRelationKind } from '../../services/relations.service';

const KIND_OPTIONS: { value: NewRelationKind; label: string }[] = [
  { value: 'blockedBy', label: 'Blocked by' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'related', label: 'Related to' },
  { value: 'duplicateOf', label: 'Duplicate of' },
];

// Adds a relation from this issue: pick how the other issue relates, then search
// for it. Marking the issue as a duplicate warns that it will be closed (the API
// moves a new duplicate to a canceled state, as Linear does).
export default function IssueRelationPicker({
  issueId,
  pending,
  onPick,
}: {
  issueId: string;
  pending: boolean;
  onPick: (kind: NewRelationKind, otherId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NewRelationKind>('related');
  const [term, setTerm] = useState('');
  const results = useRelationSearchQuery(term, issueId).data ?? [];

  function pick(otherId: string) {
    onPick(kind, otherId);
    setOpen(false);
    setTerm('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5" disabled={pending}>
          <Plus className="size-4" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <Select value={kind} onValueChange={(v) => setKind(v as NewRelationKind)}>
          <SelectTrigger className="mb-2 h-8 w-full" aria-label="Relation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === 'duplicateOf' && (
          <p className="mb-2 text-xs text-muted-foreground">
            This issue will be marked as a duplicate and moved to a canceled state.
          </p>
        )}
        <Command shouldFilter={false} className="rounded-md border">
          <CommandInput placeholder="Search issues…" value={term} onValueChange={setTerm} />
          <CommandList>
            {term.trim() && <CommandEmpty>No issues found.</CommandEmpty>}
            <CommandGroup>
              {results.map((r) => (
                <CommandItem key={r.id} value={r.id} onSelect={() => pick(r.id)}>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.identifier}</span>
                  <span className="truncate">{r.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
