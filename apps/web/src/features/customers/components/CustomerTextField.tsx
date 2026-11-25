'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// A text field saved when it loses focus or on Enter; Escape puts the saved value back.
// `parse` turns the text into the value to save, or undefined when it is not valid
// (the field is then marked and nothing is saved).
export default function CustomerTextField<T>({
  label,
  value,
  parse,
  onSave,
  className,
  placeholder,
}: {
  label: string;
  value: string;
  parse: (text: string) => T | undefined;
  onSave: (value: T) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const invalid = draft !== null && parse(draft) === undefined;

  function commit() {
    if (draft === null) return;
    const parsed = parse(draft);
    if (parsed === undefined) return;
    setDraft(null);
    if (draft !== value) onSave(parsed);
  }

  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      className={cn('h-8', className)}
      value={text}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
