'use client';

import { useState } from 'react';
import type { FeedItem } from '@/types/issue';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { canDeleteComment, canEditComment, canResolveThread } from '@/utils/commentPermissions';
import { useDeleteComment, useSetThreadResolved } from '@/services/comments.service';
import { useToggleReaction } from '@/services/reactions.service';
import { type CommentContext } from '@/utils/commentContext';
import { commentTargetKey } from '@/utils/commentTarget';
import ReactionBar from '@/components/common/reactions/ReactionBar';
import CommentActionsMenu from './CommentActionsMenu';
import CommentComposer from './CommentComposer';
import CommentItem from './CommentItem';

// A comment in a live comment list (of any comment target): the plain CommentItem plus the viewer's
// controls (edit in place, delete after a confirmation, resolve the thread on a
// root comment), its reactions, and a Reply button that opens the thread's reply
// box. Controls the API would refuse are not shown.

export default function LiveComment({
  item,
  image,
  ctx,
  resolved,
  onReply,
}: {
  item: FeedItem;
  image: string | null;
  ctx: CommentContext;
  resolved?: boolean;
  onReply: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteComment = useDeleteComment();
  const setResolved = useSetThreadResolved();
  const toggle = useToggleReaction();
  const { target, viewerId } = ctx;

  return (
    <>
      <CommentItem
        item={item}
        image={image}
        actions={
          <CommentActionsMenu
            resolved={resolved}
            onEdit={canEditComment(viewerId, item) ? () => setEditing(true) : undefined}
            onResolve={
              canResolveThread(viewerId, item)
                ? () => setResolved.mutate({ target, id: item.id, resolved: !resolved })
                : undefined
            }
            onDelete={
              canDeleteComment(viewerId, item, ctx.canManage)
                ? () => setConfirmDelete(true)
                : undefined
            }
          />
        }
        editor={
          editing ? (
            <CommentComposer
              target={target}
              assignees={ctx.assignees}
              authorName={ctx.authorName}
              authorImage={ctx.authorImage}
              editing={{ id: item.id, body: item.body ?? '' }}
              onDone={() => setEditing(false)}
            />
          ) : undefined
        }
        footer={
          !editing && (
            <div className="mt-1 flex items-center gap-2">
              <ReactionBar
                reactions={item.reactions ?? []}
                viewerId={viewerId}
                pending={toggle.isPending}
                onToggle={(emoji, mineId) =>
                  toggle.mutate({
                    target: { commentId: item.id, refresh: commentTargetKey(target) },
                    emoji,
                    mineId,
                  })
                }
              />
              {viewerId && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={onReply}
                >
                  Reply
                </button>
              )}
            </div>
          )
        }
      />
      {confirmDelete && (
        <ConfirmDialog
          title="Delete comment?"
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteComment.mutateAsync({ target, id: item.id });
          }}
          onClose={() => setConfirmDelete(false)}
        >
          {item.parentId
            ? 'This removes the reply for everyone.'
            : 'This removes the comment and its replies for everyone.'}
        </ConfirmDialog>
      )}
    </>
  );
}
