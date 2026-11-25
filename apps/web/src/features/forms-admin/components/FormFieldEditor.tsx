import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FIELD_TYPES, newFormOption, type FormField, type FormRole } from '../utils/formEditor';
import FormOptionEditor from './FormOptionEditor';

// The role a question of this kind may take, with its checkbox text.
const ROLE_FOR: Partial<Record<FormField['type'], { role: FormRole; label: string }>> = {
  shortText: { role: 'title', label: 'Use the answer as the issue title' },
  longText: { role: 'quote', label: 'Use the answer as the feedback quote' },
};

// One question: its text, whether it is required, its role (title or quote) and, for
// choice questions, the options with the label and priority each one sets.
export default function FormFieldEditor({
  field,
  error,
  teamId,
  onChange,
  onRole,
  onMove,
  onRemove,
  first,
  last,
}: {
  field: FormField;
  error?: string;
  teamId: string;
  onChange: (field: FormField) => void;
  onRole: (role: FormRole | null) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
}) {
  const kind = FIELD_TYPES.find((t) => t.type === field.type)?.label ?? field.type;
  const roleOption = ROLE_FOR[field.type];
  const options = field.options;
  const requiredId = `field-${field.id}-required`;
  const roleId = `field-${field.id}-role`;

  return (
    <div className="grid gap-3 rounded-md border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Question"
          placeholder="Question"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{kind}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move up"
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Move down"
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove question"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id={requiredId}
            checked={field.required}
            onCheckedChange={(v) => onChange({ ...field, required: v === true })}
          />
          <Label htmlFor={requiredId}>Required</Label>
        </div>
        {roleOption && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={roleId}
              checked={field.role === roleOption.role}
              onCheckedChange={(v) => onRole(v === true ? roleOption.role : null)}
            />
            <Label htmlFor={roleId}>{roleOption.label}</Label>
          </div>
        )}
      </div>
      {options && (
        <div className="grid gap-2">
          {options.map((o) => (
            <FormOptionEditor
              key={o.id}
              option={o}
              teamId={teamId}
              onChange={(next) =>
                onChange({ ...field, options: options.map((x) => (x.id === next.id ? next : x)) })
              }
              onRemove={() => onChange({ ...field, options: options.filter((x) => x.id !== o.id) })}
            />
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...field, options: [...options, newFormOption()] })}
            >
              <Plus /> Add option
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
