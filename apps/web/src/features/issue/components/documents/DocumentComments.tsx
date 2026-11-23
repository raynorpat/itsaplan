'use client';

import { type Assignee } from '@/lib/api';
import { useDocumentCommentsQuery } from '../../services/documents.service';
import { useCommentContext } from '@/hooks/useCommentContext';
import CommentComposer from '@/components/common/comments/CommentComposer';
import CommentThread from '@/components/common/comments/CommentThread';

// A document's comment threads under its body, with a composer on top. The same
// thread, reply, edit, resolve and reaction controls as the issue's feed.

export default function DocumentComments({
  documentId,
  assignees,
  imageByUserId,
}: {
  documentId: string;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
}) {
  const target = { documentId };
  const ctx = useCommentContext(target, assignees);
  const comments = useDocumentCommentsQuery(documentId);
  const entries = comments.data ?? [];

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Comments
      </h4>
      <CommentComposer
        target={target}
        assignees={assignees}
        authorName={ctx.authorName}
        authorImage={ctx.authorImage}
      />
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {comments.isLoading ? 'Loading…' : 'No comments yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {entries.map((entry) => (
            <CommentThread
              key={entry.item.id}
              entry={entry}
              imageByUserId={imageByUserId}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
