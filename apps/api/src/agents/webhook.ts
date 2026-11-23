import { randomUUID } from 'node:crypto';
import {
  agentActivity,
  comment,
  db,
  oauthClient,
  oauthInstallation,
  user,
  webhook,
  webhookDelivery,
} from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, asc, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { getComment, type CommentRow } from '../comments/store';
import { getOrganization } from '../graphql/resolvers/organization';
import { issueData } from '../webhooks/data';
import { onAgentSessionEvent, type AgentSessionEvent } from './events';
import { getSession, type SessionRow } from './store';

// Linear's AgentSessionEvent webhook (the SDL's AgentSessionEventWebhookPayload): sent
// to the webhook of the application whose app user owns the session, whatever resource
// types that webhook subscribes to, while the application is installed and not
// archived. An application without a webhook gets no event; its sessions still work.
// The worker delivers it like any webhook (signed with the application's secret).

type Data = Record<string, unknown>;

// The installed application of an app user and its enabled webhook, or null.
async function appWebhook(appUserId: string) {
  const [row] = await db
    .select({ clientId: oauthInstallation.clientId, webhookId: webhook.id })
    .from(oauthInstallation)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthInstallation.clientId))
    .innerJoin(webhook, eq(webhook.oauthClientId, oauthInstallation.clientId))
    .where(
      and(
        eq(oauthInstallation.appUserId, appUserId),
        isNull(oauthInstallation.uninstalledAt),
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
        eq(webhook.enabled, true),
      ),
    );
  return row ?? null;
}

async function userChild(id: string | null): Promise<Data | null> {
  if (!id) return null;
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.image ?? null,
    url: `${trustedOrigins[0]}/workspace/members`,
  };
}

const commentChild = (c: CommentRow): Data => ({
  id: c.id,
  body: c.body,
  userId: c.userId,
  issueId: c.issueId,
  projectUpdateId: c.projectUpdateId,
  initiativeUpdateId: c.initiativeUpdateId,
  documentContentId: c.documentId,
});

async function issueChild(issueId: string): Promise<Data | null> {
  const data = await issueData(issueId);
  if (!data) return null;
  return {
    id: data.id,
    identifier: data.identifier,
    title: data.title,
    description: data.description ?? null,
    url: data.url,
    teamId: data.teamId,
    team: data.team,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function sessionData(s: SessionRow, organizationId: string): Promise<Data> {
  const thread = s.commentId ? await getComment(s.commentId) : null;
  const issue = await issueChild(s.issueId);
  return {
    id: s.id,
    appUserId: s.appUserId,
    organizationId,
    type: 'commentThread',
    status: s.status,
    summary: s.summary,
    issueId: s.issueId,
    issue,
    commentId: s.commentId,
    comment: thread ? commentChild(thread) : null,
    sourceCommentId: s.sourceCommentId,
    creatorId: s.creatorUserId,
    creator: await userChild(s.creatorUserId),
    sourceMetadata: null,
    url: issue?.url ?? null,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    archivedAt: null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function activityData(activityId: string): Promise<Data | null> {
  const [a] = await db.select().from(agentActivity).where(eq(agentActivity.id, activityId));
  if (!a) return null;
  return {
    id: a.id,
    agentSessionId: a.sessionId,
    userId: a.userId,
    user: await userChild(a.userId),
    content: a.content,
    signal: a.signal,
    signalMetadata: a.signalMetadata,
    sourceCommentId: a.sourceCommentId,
    archivedAt: null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// The thread's comments written before the comment that started the session, for a
// session started by a mention in a reply (Linear's previousComments).
async function previousComments(s: SessionRow): Promise<CommentRow[]> {
  if (!s.commentId || !s.sourceCommentId) return [];
  const source = await getComment(s.sourceCommentId);
  if (!source) return [];
  const rows = await db
    .select({ id: comment.id })
    .from(comment)
    .where(
      and(
        or(eq(comment.id, s.commentId), eq(comment.parentId, s.commentId)),
        ne(comment.id, source.id),
        lt(comment.createdAt, new Date(source.createdAt)),
      ),
    )
    .orderBy(asc(comment.createdAt), asc(comment.id));
  const out: CommentRow[] = [];
  for (const r of rows) {
    const c = await getComment(r.id);
    if (c) out.push(c);
  }
  return out;
}

// Linear's promptContext: the issue and the session's thread as a formatted prompt.
async function promptContext(s: SessionRow, issue: Data | null): Promise<string> {
  const parts: string[] = [];
  if (issue)
    parts.push(
      `<issue identifier="${issue.identifier}">`,
      `<title>${issue.title}</title>`,
      ...(issue.description ? [`<description>${issue.description}</description>`] : []),
      `<team name="${(issue.team as { name?: string } | null)?.name ?? ''}"/>`,
      '</issue>',
    );
  if (s.commentId) {
    const rows = await db
      .select({ id: comment.id })
      .from(comment)
      .where(or(eq(comment.id, s.commentId), eq(comment.parentId, s.commentId)))
      .orderBy(asc(comment.createdAt), asc(comment.id));
    const bodies: string[] = [];
    for (const r of rows) {
      const c = await getComment(r.id);
      if (c?.body.trim()) bodies.push(`<comment author="${c.userName ?? ''}">${c.body}</comment>`);
    }
    if (bodies.length) parts.push('<thread>', ...bodies, '</thread>');
  }
  return parts.join('\n');
}

export async function sendAgentSessionEvent(event: AgentSessionEvent): Promise<void> {
  const session = await getSession(event.sessionId);
  if (!session) return;
  const target = await appWebhook(session.appUserId);
  if (!target) return;
  const organizationId = (await getOrganization()).id;
  const agentSession = await sessionData(session, organizationId);
  const payload: Data = {
    type: 'AgentSessionEvent',
    action: event.action,
    createdAt: new Date().toISOString(),
    organizationId,
    oauthClientId: target.clientId,
    appUserId: session.appUserId,
    agentSession,
    guidance: [],
    webhookId: target.webhookId,
  };
  if (event.action === 'created') {
    payload.promptContext = await promptContext(session, agentSession.issue as Data | null);
    const previous = await previousComments(session);
    if (previous.length) payload.previousComments = previous.map(commentChild);
  }
  if (event.activityId) {
    const activity = await activityData(event.activityId);
    if (activity) payload.agentActivity = activity;
  }
  await db.insert(webhookDelivery).values({
    webhookId: target.webhookId,
    eventId: randomUUID(),
    eventType: 'AgentSessionEvent',
    payload,
  });
}

// Best effort: a failure to queue the event must not fail the change that caused it.
onAgentSessionEvent(async (event) => {
  try {
    await sendAgentSessionEvent(event);
  } catch (err) {
    console.error('[agents] AgentSessionEvent enqueue failed:', err);
  }
});
