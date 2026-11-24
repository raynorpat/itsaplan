'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCommentMutations, usePortalComments } from '../../services/portal.service';
import PortalCommentBox from './PortalCommentBox';
import PortalCommentItem from './PortalCommentItem';

// The issue's comments the board shows, as threads (replies are stored under their
// root), with a reply box per thread and a box for a new thread.
export default function PortalComments({
  slug,
  identifier,
  signedIn,
}: {
  slug: string;
  identifier: string;
  signedIn: boolean;
}) {
  const comments = usePortalComments(slug, identifier).data ?? [];
  const { create, edit, remove } = useCommentMutations(slug, identifier);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const busy = create.isPending || edit.isPending || remove.isPending;
  const roots = comments.filter((c) => !c.parentId);

  const item = (c: (typeof comments)[number]) => (
    <PortalCommentItem
      key={c.id}
      comment={c}
      busy={busy}
      onEdit={(body) => edit.mutate({ id: c.id, body })}
      onDelete={() => remove.mutate(c.id)}
    />
  );

  return (
    <section className="flex flex-col gap-6" aria-label="Comments">
      <h2 className="text-sm font-medium">Comments</h2>
      {roots.map((root) => (
        <div key={root.id} className="flex flex-col gap-3">
          {item(root)}
          <div className="flex flex-col gap-3 pl-6">
            {comments.filter((c) => c.parentId === root.id).map(item)}
            {signedIn &&
              (replyTo === root.id ? (
                <PortalCommentBox
                  placeholder="Reply"
                  submitLabel="Reply"
                  busy={busy}
                  onCancel={() => setReplyTo(null)}
                  onSubmit={(body) =>
                    create.mutate(
                      { body, parentId: root.id },
                      { onSuccess: () => setReplyTo(null) },
                    )
                  }
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setReplyTo(root.id)}
                >
                  Reply
                </Button>
              ))}
          </div>
        </div>
      ))}
      {signedIn ? (
        <PortalCommentBox
          placeholder="Leave a comment"
          submitLabel="Comment"
          busy={busy}
          onSubmit={(body) => create.mutate({ body })}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href={`/portal/${slug}/sign-in`} className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          to comment.
        </p>
      )}
    </section>
  );
}
