'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Avatar from '@/components/common/Avatar';
import AppBadge from '@/components/common/AppBadge';
import LiveComment from '@/components/common/comments/LiveComment';
import type { FeedItem } from '@/types/issue';
import { type CommentContext } from '@/utils/commentContext';
import { useAgentSession, useStopAgentSession } from '../../services/agentSession.service';
import { canStopSession, sessionTimeline } from '../../utils/agentSession';
import AgentActivityMessage from './AgentActivityMessage';
import AgentSessionStatusChip from './AgentSessionStatusChip';
import AgentSessionSteps from './AgentSessionSteps';

// One agent session of a thread: the agent, the session's status and links, Stop, and
// its work (steps collapsed, questions and results as messages). The thread's first
// session also shows the people's replies (`mergeReplies`); a later one only hides
// the prompts those replies became.
export default function AgentSessionPanel({
  issueId,
  sessionId,
  fallbackName,
  replies,
  mergeReplies,
  imageByUserId,
  ctx,
  onReply,
}: {
  issueId: string;
  sessionId: string;
  fallbackName: string | null;
  replies: FeedItem[];
  mergeReplies: boolean;
  imageByUserId: Map<string, string | null>;
  ctx: CommentContext;
  onReply: () => void;
}) {
  const session = useAgentSession(issueId, sessionId);
  const stop = useStopAgentSession(issueId, sessionId);
  const image = (userId: string | null) => (userId && imageByUserId.get(userId)) ?? null;
  const data = session.data;
  const rows = data ? sessionTimeline(data.activities, replies, mergeReplies) : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar
          name={data?.appName ?? fallbackName ?? 'Agent'}
          image={data?.appImage ?? null}
          className="size-5 text-[9px]"
        />
        <span className="text-sm font-medium">{data?.appName ?? fallbackName}</span>
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
                    onReply={onReply}
                  />
                );
            }
          })}
        </ul>
      )}
    </div>
  );
}
