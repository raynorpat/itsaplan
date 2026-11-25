'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MAX_ANSWER_LENGTH, type Answers, type PublicFormField } from '@/utils/formAnswers';

// One question of a public form, labelled, with its error under it.
export default function FormFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: PublicFormField;
  value: Answers[string] | undefined;
  error?: string;
  onChange: (value: Answers[string]) => void;
}) {
  const id = `form-field-${field.id}`;
  const label = (
    <span className="text-sm font-medium">
      {field.label}
      {field.required && <span className="text-muted-foreground"> *</span>}
    </span>
  );

  let control;
  switch (field.type) {
    case 'shortText':
      control = (
        <Input
          id={id}
          maxLength={field.role === 'title' ? 255 : MAX_ANSWER_LENGTH}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'longText':
      control = (
        <Textarea
          id={id}
          rows={5}
          maxLength={MAX_ANSWER_LENGTH}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'select':
      control = (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'multiSelect': {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5">{label}</legend>
          {(field.options ?? []).map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={chosen.includes(o.id)}
                onCheckedChange={(on) =>
                  onChange(on ? [...chosen, o.id] : chosen.filter((c) => c !== o.id))
                }
              />
              {o.label}
            </label>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </fieldset>
      );
    }
    case 'checkbox':
      return (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value === true}
              onCheckedChange={(on) => onChange(on === true)}
            />
            {label}
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id}>{label}</label>
      {control}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
