'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Edits a feedback item's quote in place. ⌘/Ctrl+Enter saves, Escape cancels.
export default function FeedbackQuoteEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Textarea
        autoFocus
        value={body}
        aria-label="Quote"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(body);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={saving} onClick={() => onSave(body)}>
          Save
        </Button>
      </div>
    </div>
  );
}
