'use client';

import { useState } from 'react';
import CommentComposer from '@/components/common/comments/CommentComposer';
import LiveComment from '@/components/common/comments/LiveComment';
import { type FeedEntry } from '@/utils/commentThreads';
import { type CommentContext } from '@/utils/commentContext';
import AgentSessionPanel from './AgentSessionPanel';

// A comment thread that holds agent sessions, in the issue feed: the root comment
// when a person wrote it (a mention; the root of a delegation session is an empty
// comment by the agent), one panel per session in the thread (a second agent
// mentioned in a reply has its own), and a reply box (a reply reaches every agent in
// the thread as a prompt).
export default function AgentSessionThread({
  entry,
  sessionIds,
  imageByUserId,
  ctx,
}: {
  entry: FeedEntry;
  sessionIds: string[];
  imageByUserId: Map<string, string | null>;
  ctx: CommentContext;
}) {
  const root = entry.item;
  const [replying, setReplying] = useState(false);
  const image = (userId: string | null) => (userId && imageByUserId.get(userId)) ?? null;

  return (
    <li className="flex flex-col gap-2">
      {root.body?.trim() && (
        <ul>
          <LiveComment
            item={root}
            image={image(root.actorUserId)}
            ctx={ctx}
            onReply={() => setReplying(true)}
          />
        </ul>
      )}
      <div className="ml-10 flex flex-col gap-3 rounded-lg bg-muted/30 p-3">
        {sessionIds.map((sessionId, i) => (
          <AgentSessionPanel
            key={sessionId}
            issueId={root.issueId}
            sessionId={sessionId}
            fallbackName={i === 0 ? root.actorName : null}
            replies={entry.replies}
            mergeReplies={i === 0}
            imageByUserId={imageByUserId}
            ctx={ctx}
            onReply={() => setReplying(true)}
          />
        ))}
        {replying ? (
          <CommentComposer
            target={ctx.target}
            assignees={ctx.assignees}
            authorName={ctx.authorName}
            authorImage={ctx.authorImage}
            parentId={root.id}
            onDone={() => setReplying(false)}
          />
        ) : (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setReplying(true)}
          >
            Reply to the agent…
          </button>
        )}
      </div>
    </li>
  );
}
