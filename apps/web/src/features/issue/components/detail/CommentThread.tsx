'use client';

import { useState } from 'react';
import { type FeedEntry } from '@/utils/feed';
import CommentItem from './CommentItem';

// A root comment with its replies, oldest first, indented under it. A resolved
// thread shows its root only, with a toggle that expands the replies (Linear's
// collapsed resolved threads).

export default function CommentThread({
  entry,
  imageByUserId,
}: {
  entry: FeedEntry;
  imageByUserId: Map<string, string | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const image = (userId: string | null) => (userId && imageByUserId.get(userId)) ?? null;
  const showReplies = !entry.resolved || expanded;

  return (
    <li className="flex flex-col gap-2">
      <ul>
        <CommentItem item={entry.item} image={image(entry.item.actorUserId)} />
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
            <CommentItem key={reply.id} item={reply} image={image(reply.actorUserId)} />
          ))}
        </ul>
      )}
    </li>
  );
}
