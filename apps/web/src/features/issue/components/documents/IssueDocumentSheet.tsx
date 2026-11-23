'use client';

import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { type Assignee } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { documentTitle } from '@/utils/documents';
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
// rights the title and body are read-only and Delete is hidden.

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
              defaultValue={document.title}
              key={`doc-title-${document.updatedAt}`}
              readOnly={!canEdit}
              onBlur={(e) => {
                const title = e.target.value.trim();
                if (title && title !== document.title)
                  update.mutate({ id: document.id, patch: { title } });
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
          <IssueMarkdownEditor
            defaultValue={document.content ?? ''}
            key={`doc-body-${document.updatedAt}`}
            editable={canEdit}
            placeholder="Write something…"
            onBlur={(md) => {
              if (md !== (document.content ?? ''))
                update.mutate({ id: document.id, patch: { content: md } });
            }}
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
