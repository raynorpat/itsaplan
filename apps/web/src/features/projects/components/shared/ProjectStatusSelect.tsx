import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ProjectStatus } from '@/types/project';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { colorDot } from '@/components/common/fields/colorDot';
import { Pill } from '@/components/common/fields/Pill';
import ReadOnlyPill from '@/components/common/fields/ReadOnlyPill';
import { STATUS_META, STATUS_ORDER } from '@/utils/projectMeta';

// A Pill trigger opening the fixed project status lifecycle. Mirrors the issue
// field selects (Pill + Popover + Command) but over a static enum.
export default function ProjectStatusSelect({
  value,
  onChange,
  readOnly = false,
}: {
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[value];
  const pill = (
    <Pill active>
      {colorDot(meta.color)}
      {meta.label}
    </Pill>
  );
  if (readOnly) return <ReadOnlyPill>{pill}</ReadOnlyPill>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{pill}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {STATUS_ORDER.map((s) => (
                <CommandItem
                  key={s}
                  value={STATUS_META[s].label}
                  onSelect={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  {colorDot(STATUS_META[s].color)}
                  <span className="flex-1">{STATUS_META[s].label}</span>
                  {s === value && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
