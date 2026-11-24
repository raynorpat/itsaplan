'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function PortalCommentBox({
  initial = '',
  placeholder,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        onSubmit(body.trim());
        if (!initial) setBody('');
      }}
    >
      <Textarea
        aria-label={placeholder ?? 'Comment'}
        placeholder={placeholder}
        rows={3}
        maxLength={10_000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!body.trim() || busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
