'use client';

import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { useUpdateInitiative, type InitiativeDetail } from '../services/initiatives.service';

// The initiative's Markdown overview (Linear's Initiative.content), edited in place
// and saved through initiativeUpdate when the editor loses focus.
export default function InitiativeDescription({ initiative }: { initiative: InitiativeDetail }) {
  const update = useUpdateInitiative(initiative.id);
  return (
    <MarkdownEditor
      key={`content-${initiative.updatedAt}`}
      className="text-sm"
      defaultValue={initiative.content}
      placeholder="Add an overview…"
      onBlur={(content) => {
        if (content !== initiative.content) update.mutate({ content });
      }}
    />
  );
}
