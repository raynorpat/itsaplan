'use client';

import { useState } from 'react';
import type { ProjectHealth } from '@/lib/api';
import { Button } from '@/components/ui/button';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import HealthSelect from './HealthSelect';

// The health and Markdown body of a new project or initiative update, or of one
// being edited. A new update starts from the item's current health.
export default function UpdateForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: { body: string; health: ProjectHealth };
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: { body: string; health: ProjectHealth }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [health, setHealth] = useState(initial.health);
  const [body, setBody] = useState(initial.body);
  // Remounts the editor to clear it after a new update is posted.
  const [round, setRound] = useState(0);

  const submit = async () => {
    if (!body.trim()) return;
    await onSubmit({ body: body.trim(), health });
    setBody(initial.body);
    setRound((r) => r + 1);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <MarkdownEditor
        key={round}
        className="min-h-16 text-sm"
        defaultValue={initial.body}
        placeholder="Write an update…"
        onChange={setBody}
      />
      <div className="flex items-center justify-between gap-2">
        <HealthSelect value={health} onChange={setHealth} />
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" disabled={!body.trim() || busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
