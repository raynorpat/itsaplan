'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DatePill from '@/components/common/fields/DatePill';

// The name and target date of a new milestone, or of one being edited.
export default function ProjectMilestoneForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: { name: string; targetDate: string | null };
  busy: boolean;
  onSave: (fields: { name: string; targetDate: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? null);
  const save = () => {
    if (name.trim()) void onSave({ name: name.trim(), targetDate });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <Input
        autoFocus
        value={name}
        placeholder="Milestone name"
        className="h-8 min-w-40 flex-1"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <DatePill value={targetDate} placeholder="Target date" onChange={setTargetDate} />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" disabled={!name.trim() || busy} onClick={save}>
        Save
      </Button>
    </div>
  );
}
