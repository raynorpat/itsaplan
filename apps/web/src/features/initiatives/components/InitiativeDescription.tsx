'use client';

import DraftMarkdownEditor from '@/components/common/editor/DraftMarkdownEditor';
import { useUpdateInitiative, type InitiativeDetail } from '../services/initiatives.service';

// The initiative's Markdown overview (Linear's Initiative.content), edited in place
// and saved through initiativeUpdate when the editor loses focus; unsaved typing
// survives a refresh (DraftMarkdownEditor).
export default function InitiativeDescription({ initiative }: { initiative: InitiativeDetail }) {
  const update = useUpdateInitiative(initiative.id);
  return (
    <DraftMarkdownEditor
      className="text-sm"
      value={initiative.content}
      placeholder="Add an overview…"
      onSave={(content) => update.mutate({ content })}
    />
  );
}
