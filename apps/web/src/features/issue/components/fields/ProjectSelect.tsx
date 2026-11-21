import { useState } from 'react';
import { Check, CircleDashed, Target } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectQuery, useProjectsQuery } from '@/services/projects.service';
import type { Project } from '@/lib/api';
import { qk } from '@/services/queryKeys';
import { colorDot } from '@/components/common/fields/colorDot';
import { LINKABLE_STATUSES, STATUS_META } from '@/utils/projectMeta';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pill } from '@/components/common/fields/Pill';

// The dropdown shows at most this many projects at once; the rest are reached by
// typing, which the server matches by title.
const PAGE_SIZE = 15;

// A Pill trigger opening the team's projects, for linking an issue to one.
// Lives in the shared layer so the issue detail can use it without depending on
// the projects feature. Value is the project id or null.
export default function ProjectSelect({
  teamKey,
  value,
  onChange,
}: {
  teamKey: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const qc = useQueryClient();

  // The linked project may fall outside the first page, so fetch it directly to
  // label the trigger. The list query only runs while the dropdown is open.
  const current = useProjectQuery(value).data;
  const { data } = useProjectsQuery(open ? teamKey : null, {
    statuses: LINKABLE_STATUSES,
    search: query.trim() || undefined,
    pageSize: PAGE_SIZE,
  });
  const options = data?.items ?? [];

  // Seed the single-project cache on pick so the trigger labels immediately,
  // without waiting for its own fetch.
  const select = (project: Project | null) => {
    if (project) qc.setQueryData(qk.project(project.id), project);
    onChange(project?.id ?? null);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Pill active={value != null}>
          {value != null ? <Target /> : <CircleDashed />}
          {current?.name ?? 'Project'}
        </Pill>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Link to project…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No projects.</CommandEmpty>
            <CommandGroup>
              {!query && (
                <CommandItem value="No project" onSelect={() => select(null)}>
                  <CircleDashed />
                  <span className="flex-1">No project</span>
                  {value == null && <Check className="ml-auto" />}
                </CommandItem>
              )}
              {options.map((it) => (
                <CommandItem key={it.id} value={it.name} onSelect={() => select(it)}>
                  {colorDot(STATUS_META[it.status].color)}
                  <span className="flex-1 truncate">{it.name}</span>
                  {it.id === value && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
