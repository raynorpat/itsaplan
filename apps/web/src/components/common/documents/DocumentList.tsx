'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import type { Assignee } from '@/types/team';
import { Button } from '@/components/ui/button';
import { type DocumentParent } from '@/utils/documentParent';
import { documentSlugFromHash } from '@/utils/documents';
import { useCreateDocument, useDocumentsQuery } from '@/services/documents.service';
import DocumentRow from './DocumentRow';
import DocumentSheet from './DocumentSheet';

// The documents of an issue or a project (Linear's issue and project documents): a
// list that opens each one in a side sheet, and "New document" for someone who may
// edit the parent. `heading` hides the section title where a page tab names it. A
// `#document-<slugId>` fragment (Linear's Document.url, e.g. from a favorite) opens
// that document.

export default function DocumentList({
  parent,
  heading = true,
  canEdit,
  assignees,
  imageByUserId,
}: {
  parent: DocumentParent;
  heading?: boolean;
  canEdit: boolean;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
}) {
  const documents = useDocumentsQuery(parent);
  const create = useCreateDocument(parent);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = documents.data ?? [];
  const open = list.find((d) => d.id === openId) ?? null;

  const loaded = documents.data;
  useEffect(() => {
    if (!loaded?.length) return;
    const openFromHash = () => {
      const slug = documentSlugFromHash(window.location.hash);
      const found = slug ? loaded.find((d) => d.slugId === slug) : undefined;
      if (found) setOpenId(found.id);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [loaded]);

  if (list.length === 0 && !canEdit) return null;

  return (
    <section className={heading ? 'mt-6' : undefined}>
      <div className="mb-2 flex items-center justify-between">
        {heading ? (
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileText className="size-3.5" />
            Documents
          </h3>
        ) : (
          <span />
        )}
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
            <DocumentRow key={doc.id} document={doc} onOpen={() => setOpenId(doc.id)} />
          ))}
        </ul>
      )}
      {open && (
        <DocumentSheet
          parent={parent}
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
