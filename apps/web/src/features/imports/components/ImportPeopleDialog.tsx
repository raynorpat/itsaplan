import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useImportPeopleQuery, useProcessImport } from '../services/imports.service';
import { isCsvImport, statusMappingInput, statusValues } from '../utils/csvImport';
import { peopleMappingInput, type ImportView } from '../utils/imports';
import ImportStatusFields from './ImportStatusFields';

const UNMATCHED = '__none__';

// The people step (Linear's mapping review): each person found in the source, with a
// member to credit their issues and comments to. Suggestions (email, or an identical
// name or username) come prefilled; an unmatched person's issues stay unassigned, with
// the importer as creator.
export default function ImportPeopleDialog({
  imp,
  onClose,
}: {
  imp: ImportView;
  onClose: () => void;
}) {
  const { data, isPending, error } = useImportPeopleQuery(imp.id);
  const process = useProcessImport();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const csv = isCsvImport(imp);

  useEffect(() => {
    if (data)
      setChosen(Object.fromEntries(data.people.map((p) => [p.key, p.suggestion ?? UNMATCHED])));
  }, [data]);

  async function submit() {
    const people = peopleMappingInput(
      Object.entries(chosen).map(([key, memberId]) => ({
        key,
        memberId: memberId === UNMATCHED ? null : memberId,
      })),
    );
    try {
      await process.mutateAsync({
        imp,
        people,
        ...(csv ? { statuses: statusMappingInput(statuses) } : {}),
      });
      onClose();
    } catch {
      // The app's mutation error toast reports it; the dialog stays open to retry.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{csv ? 'Match statuses and people' : 'Match people'}</DialogTitle>
        <DialogDescription>
          {csv ? 'Choose the state each status in the file becomes, and ' : 'Choose '}
          the member each person&apos;s issues and comments belong to. Unmatched people&apos;s
          issues are left unassigned and credited to you.
        </DialogDescription>
        {csv && (
          <ImportStatusFields
            teamId={imp.teamId}
            statuses={statusValues(imp.serviceMetadata ?? {})}
            chosen={statuses}
            onChange={setStatuses}
          />
        )}
        {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && data.people.length === 0 && (
          <p className="text-sm text-muted-foreground">No people were found in the source.</p>
        )}
        {data && data.people.length > 0 && (
          <ul className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto">
            {data.people.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name ?? p.login}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.login}
                    {p.email ? ` · ${p.email}` : ''} · {p.issues}{' '}
                    {p.issues === 1 ? 'issue' : 'issues'}
                  </div>
                </div>
                <Select
                  value={chosen[p.key] ?? UNMATCHED}
                  onValueChange={(v) => setChosen((c) => ({ ...c, [p.key]: v }))}
                >
                  <SelectTrigger aria-label={`Member for ${p.login}`} className="w-48 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMATCHED}>Unmatched</SelectItem>
                    {data.members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!data || process.isPending}>
            {process.isPending ? 'Starting…' : 'Start import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
