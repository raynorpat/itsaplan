'use client';

import { useState } from 'react';
import { type FeedEntry } from '@/utils/commentThreads';
import { type CommentContext } from '@/utils/commentContext';
import CommentComposer from './CommentComposer';
import LiveComment from './LiveComment';

// A root comment with its replies, oldest first, indented under it, and the
// thread's reply box (opened by any comment's Reply). A resolved thread shows its
// root only, with a toggle that expands the replies (Linear's collapsed resolved
// threads). Every reply is posted under the root, as the API stores replies.

export default function CommentThread({
  entry,
  imageByUserId,
  ctx,
}: {
  entry: FeedEntry;
  imageByUserId: Map<string, string | null>;
  ctx: CommentContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const image = (userId: string | null) => (userId && imageByUserId.get(userId)) ?? null;
  const showReplies = !entry.resolved || expanded;
  const root = entry.item;
  const openReply = () => {
    setExpanded(true);
    setReplying(true);
  };

  return (
    <li className="flex flex-col gap-2">
      <ul>
        <LiveComment
          item={root}
          image={image(root.actorUserId)}
          ctx={ctx}
          resolved={entry.resolved}
          onReply={openReply}
        />
      </ul>
      {entry.resolved && (
        <button
          type="button"
          className="ml-10 self-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? 'Hide resolved thread'
            : `Resolved thread${entry.replies.length ? ` · ${entry.replies.length} ${entry.replies.length === 1 ? 'reply' : 'replies'}` : ''}`}
        </button>
      )}
      {showReplies && entry.replies.length > 0 && (
        <ul className="ml-10 flex flex-col gap-2.5">
          {entry.replies.map((reply) => (
            <LiveComment
              key={reply.id}
              item={reply}
              image={image(reply.actorUserId)}
              ctx={ctx}
              onReply={openReply}
            />
          ))}
        </ul>
      )}
      {replying && (
        <div className="ml-10">
          <CommentComposer
            target={ctx.target}
            assignees={ctx.assignees}
            authorName={ctx.authorName}
            authorImage={ctx.authorImage}
            parentId={root.parentId ?? root.id}
            onDone={() => setReplying(false)}
          />
        </div>
      )}
    </li>
  );
}
