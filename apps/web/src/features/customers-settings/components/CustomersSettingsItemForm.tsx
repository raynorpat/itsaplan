'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ColorField from '@/components/common/fields/ColorField';

export interface ItemFormValue {
  name: string;
  color: string;
  description: string;
}

// The inline form for a new or edited status or tier.
export default function CustomersSettingsItemForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: ItemFormValue;
  onSubmit: (value: ItemFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ ...value, name: value.name.trim(), description: value.description.trim() });
    } catch {
      // The global mutation handler shows the error; the form stays open.
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
    >
      <ColorField value={value.color} onChange={(color) => setValue({ ...value, color })} />
      <Input
        autoFocus
        aria-label="Name"
        placeholder="Name"
        value={value.name}
        onChange={(e) => setValue({ ...value, name: e.target.value })}
        className="h-8 w-40"
      />
      <Input
        aria-label="Description"
        placeholder="Description (optional)"
        value={value.description}
        onChange={(e) => setValue({ ...value, description: e.target.value })}
        className="h-8 min-w-48 flex-1"
      />
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="sm" disabled={busy || !value.name.trim()}>
        Save
      </Button>
    </form>
  );
}
