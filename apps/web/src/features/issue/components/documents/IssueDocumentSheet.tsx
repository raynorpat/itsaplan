'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { type Assignee } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { documentTitle, syncDraft } from '@/utils/documents';
import {
  type IssueDocument,
  useRestoreIssueDocument,
  useTrashIssueDocument,
  useUpdateIssueDocument,
} from '../../services/documents.service';
import IssueMarkdownEditor from '../editor/IssueMarkdownEditor';
import DocumentComments from './DocumentComments';

// One issue document opened in a side sheet: its title and Markdown body (saved on
// blur), its comments, and Delete (moves it to the trash, with Undo). Without edit
// rights the title and body are read-only and Delete is hidden. Each field keeps a
// local draft: a refetched document only replaces it when the field is not being
// edited and holds no unsaved change (syncDraft), so a save landing while the user
// types in the other field never discards their input.

export default function IssueDocumentSheet({
  issueId,
  document,
  canEdit,
  assignees,
  imageByUserId,
  onClose,
}: {
  issueId: string;
  document: IssueDocument;
  canEdit: boolean;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
  onClose: () => void;
}) {
  const update = useUpdateIssueDocument(issueId);
  const trash = useTrashIssueDocument(issueId);
  const restore = useRestoreIssueDocument(issueId);

  const serverTitle = document.title;
  const serverBody = document.content ?? '';
  const [title, setTitle] = useState({ draft: serverTitle, synced: serverTitle });
  const titleEditing = useRef(false);
  const body = useRef({ draft: serverBody, synced: serverBody });
  const bodyEditing = useRef(false);
  // Remounts the uncontrolled body editor when a server value is taken over.
  const [bodyVersion, setBodyVersion] = useState(0);

  useEffect(() => {
    setTitle((t) => syncDraft({ server: serverTitle, ...t, editing: titleEditing.current }));
  }, [serverTitle]);

  useEffect(() => {
    const next = syncDraft({ server: serverBody, ...body.current, editing: bodyEditing.current });
    const replaced = next.draft !== body.current.draft;
    body.current = next;
    if (replaced) setBodyVersion((v) => v + 1);
  }, [serverBody]);

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
          <div className="flex items-center gap-2">
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
            {canEdit && (
              <Button variant="ghost" size="icon" aria-label="Delete document" onClick={remove}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <div onFocus={() => (bodyEditing.current = true)}>
            <IssueMarkdownEditor
              defaultValue={body.current.draft}
              key={`doc-body-${document.id}-${bodyVersion}`}
              editable={canEdit}
              placeholder="Write something…"
              onChange={(md) => (body.current = { ...body.current, draft: md })}
              onBlur={(md) => {
                bodyEditing.current = false;
                body.current = { ...body.current, draft: md };
                if (md !== body.current.synced)
                  update.mutate({ id: document.id, patch: { content: md } });
              }}
            />
          </div>
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
