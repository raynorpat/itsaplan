'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { type Assignee } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useCreateIssueDocument, useIssueDocumentsQuery } from '../../services/documents.service';
import IssueDocumentRow from './IssueDocumentRow';
import IssueDocumentSheet from './IssueDocumentSheet';

// The issue's documents (Linear's issue documents): a list that opens each one in a
// side sheet, and "New document" for someone who can edit the issue's team.

export default function IssueDocuments({
  issueId,
  canEdit,
  assignees,
  imageByUserId,
}: {
  issueId: string;
  canEdit: boolean;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
}) {
  const documents = useIssueDocumentsQuery(issueId);
  const create = useCreateIssueDocument(issueId);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = documents.data ?? [];
  const open = list.find((d) => d.id === openId) ?? null;

  if (list.length === 0 && !canEdit) return null;

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Documents
        </h3>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            disabled={create.isPending}
            onClick={async () => {
              const id = await create.mutateAsync({ title: 'Untitled' });
              if (id) setOpenId(id);
            }}
          >
            <Plus className="size-4" />
            New document
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {documents.isLoading ? 'Loading…' : 'No documents yet.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((doc) => (
            <IssueDocumentRow key={doc.id} document={doc} onOpen={() => setOpenId(doc.id)} />
          ))}
        </ul>
      )}
      {open && (
        <IssueDocumentSheet
          issueId={issueId}
          document={open}
          canEdit={canEdit}
          assignees={assignees}
          imageByUserId={imageByUserId}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}
