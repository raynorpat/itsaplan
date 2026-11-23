'use client';

import { useEffect, useRef, useState } from 'react';
import { syncDraft } from '@/utils/documents';
import MarkdownEditor from './MarkdownEditor';

// A Markdown field saved on blur that keeps a local draft: a new server value only
// replaces the draft when the field is not being edited and holds no unsaved change
// (syncDraft), so a refetch landing while the user types never discards their input.
export default function DraftMarkdownEditor({
  value,
  onSave,
  editable = true,
  placeholder,
  className,
}: {
  value: string;
  onSave: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const body = useRef({ draft: value, synced: value });
  const editing = useRef(false);
  // Remounts the uncontrolled editor when a server value is taken over.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const next = syncDraft({ server: value, ...body.current, editing: editing.current });
    const replaced = next.draft !== body.current.draft;
    body.current = next;
    if (replaced) setVersion((v) => v + 1);
  }, [value]);

  return (
    <div className={className} onFocus={() => (editing.current = true)}>
      <MarkdownEditor
        key={version}
        defaultValue={body.current.draft}
        editable={editable}
        placeholder={placeholder}
        onChange={(md) => (body.current = { ...body.current, draft: md })}
        onBlur={(md) => {
          editing.current = false;
          body.current = { ...body.current, draft: md };
          if (md !== body.current.synced) onSave(md);
        }}
      />
    </div>
  );
}
