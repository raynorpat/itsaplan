import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRIORITY_FIELDS } from '@/components/common/fields/priorityFields';
import { useFormTeamScaffold } from '../hooks/useFormTeamScaffold';
import type { FormFieldOption } from '../utils/formEditor';

// Select values meaning "this option sets nothing".
const NONE = 'none';

// One option of a choice question: its text, the label choosing it adds and the
// priority it sets.
export default function FormOptionEditor({
  option,
  teamId,
  onChange,
  onRemove,
}: {
  option: FormFieldOption;
  teamId: string;
  onChange: (option: FormFieldOption) => void;
  onRemove: () => void;
}) {
  const { labels } = useFormTeamScaffold(teamId);
  const setLabel = (v: string) => {
    const { labelId: _l, ...rest } = option;
    onChange(v === NONE ? rest : { ...rest, labelId: v });
  };
  const setPriority = (v: string) => {
    const { priority: _p, ...rest } = option;
    onChange(v === NONE ? rest : { ...rest, priority: Number(v) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pl-4">
      <Input
        aria-label="Option"
        placeholder="Option"
        className="w-full sm:w-56"
        value={option.label}
        onChange={(e) => onChange({ ...option, label: e.target.value })}
      />
      <Select value={option.labelId ?? NONE} onValueChange={setLabel} disabled={!teamId}>
        <SelectTrigger aria-label="Adds label" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Adds no label</SelectItem>
          {labels.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              Adds {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={option.priority != null ? String(option.priority) : NONE}
        onValueChange={setPriority}
      >
        <SelectTrigger aria-label="Sets priority" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Keeps the priority</SelectItem>
          {PRIORITY_FIELDS.map((p) => (
            <SelectItem key={p.value} value={String(p.value)}>
              Sets {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Remove option"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
