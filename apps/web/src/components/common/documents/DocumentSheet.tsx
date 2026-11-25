'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { Assignee } from '@/types/team';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { documentTitle, syncDraft } from '@/utils/documents';
import { type DocumentParent } from '@/utils/documentParent';
import {
  type DocumentItem,
  useRestoreDocument,
  useTrashDocument,
  useUpdateDocument,
} from '@/services/documents.service';
import DraftMarkdownEditor from '../editor/DraftMarkdownEditor';
import DocumentComments from './DocumentComments';
import FavoriteStarButton from '@/components/common/favorites/FavoriteStarButton';

// One document (of an issue or a project) opened in a side sheet: its title and Markdown body (saved on
// blur), its comments, and Delete (moves it to the trash, with Undo). Without edit
// rights the title and body are read-only and Delete is hidden. Each field keeps a
// local draft: a refetched document only replaces it when the field is not being
// edited and holds no unsaved change (syncDraft), so a save landing while the user
// types in the other field never discards their input.

export default function DocumentSheet({
  parent,
  document,
  canEdit,
  assignees,
  imageByUserId,
  onClose,
}: {
  parent: DocumentParent;
  document: DocumentItem;
  canEdit: boolean;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
  onClose: () => void;
}) {
  const update = useUpdateDocument(parent);
  const trash = useTrashDocument(parent);
  const restore = useRestoreDocument(parent);

  const serverTitle = document.title;
  const serverBody = document.content ?? '';
  const [title, setTitle] = useState({ draft: serverTitle, synced: serverTitle });
  const titleEditing = useRef(false);

  useEffect(() => {
    setTitle((t) => syncDraft({ server: serverTitle, ...t, editing: titleEditing.current }));
  }, [serverTitle]);

  const remove = async () => {
    await trash.mutateAsync(document.id);
    onClose();
    toast.success(`Moved "${documentTitle(document.title)}" to the trash.`, {
      action: { label: 'Undo', onClick: () => restore.mutate(document.id) },
    });
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="sr-only">{documentTitle(document.title)}</SheetTitle>
          {/* pr-8 keeps the star and delete buttons clear of the sheet's close button. */}
          <div className="flex items-center gap-2 pr-8">
            <input
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
              placeholder="Document title"
              value={title.draft}
              readOnly={!canEdit}
              onFocus={() => (titleEditing.current = true)}
              onChange={(e) => setTitle((t) => ({ ...t, draft: e.target.value }))}
              onBlur={(e) => {
                titleEditing.current = false;
                const next = e.target.value.trim();
                if (next && next !== title.synced)
                  update.mutate({ id: document.id, patch: { title: next } });
              }}
            />
            <FavoriteStarButton target={{ kind: 'document', id: document.id }} />
            {canEdit && (
              <Button variant="ghost" size="icon" aria-label="Delete document" onClick={remove}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <DraftMarkdownEditor
            key={document.id}
            value={serverBody}
            editable={canEdit}
            placeholder="Write something…"
            onSave={(content) => update.mutate({ id: document.id, patch: { content } })}
          />
          <DocumentComments
            documentId={document.id}
            assignees={assignees}
            imageByUserId={imageByUserId}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
