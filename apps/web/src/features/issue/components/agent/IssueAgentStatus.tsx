'use client';

import { useFeedQuery } from '../../services/issueFeed.service';
import { useIssueSessionStatus } from '../../services/agentSession.service';
import { threadSessionIds } from '../../utils/agentSession';
import AgentSessionStatusChip from './AgentSessionStatusChip';

// The status of the issue's open agent session (the newest thread's first), shown with
// the issue's properties. Nothing when no session is open. Reads the session views the
// feed loads.
export default function IssueAgentStatus({ issueId }: { issueId: string }) {
  const feed = useFeedQuery(issueId);
  const sessionIds = (feed.data ?? []).flatMap((entry) =>
    entry.item.kind === 'comment' ? threadSessionIds(entry) : [],
  );
  const status = useIssueSessionStatus(issueId, sessionIds);
  return status ? <AgentSessionStatusChip status={status} /> : null;
}
