'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Avatar from '@/components/common/Avatar';
import AppBadge from '@/components/common/AppBadge';
import CommentComposer from '@/components/common/comments/CommentComposer';
import LiveComment from '@/components/common/comments/LiveComment';
import { type FeedEntry } from '@/utils/commentThreads';
import { type CommentContext } from '@/utils/commentContext';
import { useAgentSession, useStopAgentSession } from '../../services/agentSession.service';
import { canStopSession, sessionTimeline } from '../../utils/agentSession';
import AgentActivityMessage from './AgentActivityMessage';
import AgentSessionStatusChip from './AgentSessionStatusChip';
import AgentSessionSteps from './AgentSessionSteps';

// An agent session in the issue feed: the agent, the session's status and links,
// its work (steps collapsed, questions and results as messages), the people's
// replies, a reply box (a reply reaches the agent as a prompt) and Stop. The
// thread's root comment is shown only when a person wrote it (a mention); the root
// of a delegation session is an empty comment by the agent.
export default function AgentSessionThread({
  entry,
  sessionId,
  imageByUserId,
  ctx,
}: {
  entry: FeedEntry;
  sessionId: string;
  imageByUserId: Map<string, string | null>;
  ctx: CommentContext;
}) {
  const root = entry.item;
  const session = useAgentSession(root.issueId, sessionId);
  const stop = useStopAgentSession(root.issueId, sessionId);
  const [replying, setReplying] = useState(false);
  const image = (userId: string | null) => (userId && imageByUserId.get(userId)) ?? null;
  const data = session.data;
  const rows = data ? sessionTimeline(data.activities, entry.replies) : [];

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
      <div className="ml-10 flex flex-col gap-2 rounded-lg bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Avatar
            name={data?.appName ?? root.actorName ?? 'Agent'}
            image={data?.appImage ?? null}
            className="size-5 text-[9px]"
          />
          <span className="text-sm font-medium">{data?.appName ?? root.actorName}</span>
          <AppBadge />
          {data && <AgentSessionStatusChip status={data.status} />}
          {data?.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              {l.label}
            </a>
          ))}
          {data && canStopSession(data.status) && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              Stop
            </Button>
          )}
        </div>
        {session.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Waiting for the agent…</p>
        )}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              switch (row.kind) {
                case 'steps':
                  return <AgentSessionSteps key={row.id} activities={row.activities} />;
                case 'message':
                  return <AgentActivityMessage key={row.id} activity={row.activity} />;
                case 'prompt':
                  return (
                    <li key={row.id} className="text-xs text-muted-foreground">
                      {row.activity.signal === 'stop'
                        ? `${row.activity.userName} stopped the agent`
                        : row.activity.body}
                    </li>
                  );
                case 'reply':
                  return (
                    <LiveComment
                      key={row.id}
                      item={row.item}
                      image={image(row.item.actorUserId)}
                      ctx={ctx}
                      onReply={() => setReplying(true)}
                    />
                  );
              }
            })}
          </ul>
        )}
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
