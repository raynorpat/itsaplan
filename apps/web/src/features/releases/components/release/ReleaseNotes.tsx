'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import DraftMarkdownEditor from '@/components/common/editor/DraftMarkdownEditor';
import {
  fetchNoteDraft,
  useReleaseNoteWrites,
  type ReleaseDetail,
} from '@/services/releases.service';
import ReleaseSection from '../ReleaseSection';

// The release's notes: one Markdown note written by hand or filled from the release's
// completed issues (grouped by label). Filling over an existing note asks first. A
// note covering several releases (made through the API) is edited here too.
export default function ReleaseNotes({
  release,
  canEdit,
}: {
  release: ReleaseDetail;
  canEdit: boolean;
}) {
  const { create, update, remove } = useReleaseNoteWrites();
  const [filling, setFilling] = useState(false);
  const [confirmFill, setConfirmFill] = useState(false);
  const note = release.notes[0] ?? null;

  const save = (content: string) => {
    if (note) {
      if (content !== note.content) update.mutate({ id: note.id, content });
    } else if (content.trim()) {
      create.mutate({ pipelineId: release.pipeline.id, releaseId: release.id, content });
    }
  };

  const fill = async () => {
    setFilling(true);
    try {
      const draft = await fetchNoteDraft(release.id);
      if (!draft.content.trim()) {
        toast.info('No completed issues to list yet.');
        return;
      }
      save(draft.content);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFilling(false);
    }
  };

  const actions = canEdit && (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={filling}
        onClick={() => (note ? setConfirmFill(true) : void fill())}
      >
        {filling ? 'Filling…' : 'Fill from issues'}
      </Button>
      {note && (
        <Button size="sm" variant="ghost" onClick={() => remove.mutate(note.id)}>
          Delete note
        </Button>
      )}
    </div>
  );

  if (!canEdit && !note) return null;
  return (
    <ReleaseSection title="Release notes" action={actions}>
      <div className="px-6 py-3">
        <DraftMarkdownEditor
          key={note?.id ?? 'new'}
          value={note?.content ?? ''}
          editable={canEdit}
          placeholder="Write the release notes…"
          onSave={save}
        />
      </div>
      {confirmFill && (
        <ConfirmDialog
          title="Replace the release notes?"
          confirmLabel="Replace"
          onConfirm={fill}
          onClose={() => setConfirmFill(false)}
        >
          The notes are replaced with the release&apos;s completed issues, grouped by label.
        </ConfirmDialog>
      )}
    </ReleaseSection>
  );
}
