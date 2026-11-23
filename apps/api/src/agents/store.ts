import { randomBytes } from 'node:crypto';
import {
  agentActivity,
  agentSession,
  db,
  issue,
  oauthInstallation,
  user as userTable,
} from '@repo/db';
import { APP_ROLE } from '@repo/auth';
import { and, asc, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { createComment, type CommentRow } from '../comments/store';
import { notifyAgentSession } from '../notifications/store';
import { canSeeTeam, visibleTeamIds } from '../shared/access';
import { HttpError } from '../shared/lib';
import { parseMentions } from '../shared/mentions';
import { emitAgentSessionEvent } from './events';
import {
  ACTIVITY_TYPES,
  OPEN_STATUSES,
  sessionStatusAfter,
  type ActivityType,
  type SessionStatus,
} from './status';

// Linear's agent sessions and activities (see the SDL's AgentSession / AgentActivity).
// A session belongs to one app user (an installed OAuth application) and one issue,
// and has a comment thread on the issue. Agents write thoughts, actions,
// elicitations, responses and errors; people write prompts.

export type SessionRow = typeof agentSession.$inferSelect;
export type ActivityRow = typeof agentActivity.$inferSelect;

export interface ExternalUrl {
  url: string;
  label: string;
}

const MAX_TEXT = 250_000;

// --- App users ----------------------------------------------------------------

// The active install of an app user (not uninstalled, user not suspended), or null.
async function activeInstall(appUserId: string) {
  const [row] = await db
    .select({ scopes: oauthInstallation.scopes, name: userTable.name })
    .from(oauthInstallation)
    .innerJoin(userTable, eq(userTable.id, oauthInstallation.appUserId))
    .where(
      and(
        eq(oauthInstallation.appUserId, appUserId),
        isNull(oauthInstallation.uninstalledAt),
        isNull(userTable.suspendedAt),
        eq(userTable.workspaceRole, APP_ROLE),
      ),
    );
  return row ?? null;
}

// Whether the user is an installed app user whose install granted `scope` and that
// can see the team.
async function appUserMay(userId: string, scope: string, teamId: string): Promise<boolean> {
  const install = await activeInstall(userId);
  return !!install && install.scopes.includes(scope) && (await canSeeTeam(teamId, userId));
}

// Linear's delegate: an installed app user granted `app:assignable` that can see the
// issue's team. Throws 400 otherwise.
export async function assertDelegate(teamId: string, userId: string): Promise<void> {
  if (!(await appUserMay(userId, 'app:assignable', teamId)))
    throw new HttpError(
      400,
      'The delegate must be an installed agent that can be assigned issues in this team',
    );
}

// --- Reads ----------------------------------------------------------------------

// SQL condition on agent_session: the sessions the viewer may read. A person reads
// the sessions of the issues they can see; an app user only its own sessions, on
// issues it can see.
export async function readableSessionsSql(viewerId: string): Promise<SQL> {
  const [row] = await db
    .select({ role: userTable.workspaceRole })
    .from(userTable)
    .where(eq(userTable.id, viewerId));
  const onVisibleIssue = inArray(
    agentSession.issueId,
    db
      .select({ id: issue.id })
      .from(issue)
      .where(inArray(issue.teamId, visibleTeamIds(viewerId))),
  );
  return row?.role === APP_ROLE
    ? and(eq(agentSession.appUserId, viewerId), onVisibleIssue)!
    : onVisibleIssue;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const [row] = await db.select().from(agentSession).where(eq(agentSession.id, id));
  return row ?? null;
}

// The earliest session whose thread is the comment, among those the viewer may read.
export async function sessionOfComment(
  commentId: string,
  viewerId: string,
): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.commentId, commentId), await readableSessionsSql(viewerId)))
    .orderBy(asc(agentSession.createdAt))
    .limit(1);
  return row ?? null;
}

// --- Writes ---------------------------------------------------------------------

const slug = () => randomBytes(6).toString('hex');

// Starts a session. Without `commentId` it opens a thread on the issue: an empty root
// comment by the app user, which the session's activities are shown in.
export async function startSession(input: {
  issueId: string;
  appUserId: string;
  creatorUserId: string | null;
  status: SessionStatus;
  commentId?: string | null;
  sourceCommentId?: string | null;
  externalLink?: string | null;
  externalUrls?: ExternalUrl[];
}): Promise<SessionRow> {
  let commentId = input.commentId ?? null;
  if (!commentId) {
    const thread = await createComment({
      parent: { issueId: input.issueId },
      body: '',
      actorUserId: input.appUserId,
      notify: false,
    });
    commentId = thread.id;
  }
  const now = new Date();
  const [row] = await db
    .insert(agentSession)
    .values({
      slugId: slug(),
      issueId: input.issueId,
      appUserId: input.appUserId,
      creatorUserId: input.creatorUserId,
      commentId,
      sourceCommentId: input.sourceCommentId ?? null,
      status: input.status,
      startedAt: input.status === 'active' ? now : null,
      externalLink: input.externalLink ?? null,
      externalUrls: input.externalUrls ?? [],
    })
    .returning();
  await emitAgentSessionEvent({ action: 'created', sessionId: row!.id });
  return row!;
}

// The session fields that follow from a new status: startedAt when it becomes active,
// endedAt when it completes (cleared when a turn starts again), the plan cleared on an
// error.
function statusChange(status: SessionStatus, now: Date): Partial<typeof agentSession.$inferInsert> {
  const set: Partial<typeof agentSession.$inferInsert> = { status, updatedAt: now };
  if (status === 'active') set.startedAt = now;
  if (status === 'complete') set.endedAt = now;
  if (status === 'active' || status === 'pending' || status === 'stopping') set.endedAt = null;
  if (status === 'error' || status === 'stale') set.plan = null;
  return set;
}

// Records an activity and moves the session's status. A prompt also sends the
// `prompted` event.
export async function addActivity(input: {
  session: SessionRow;
  userId: string;
  type: ActivityType;
  content: Record<string, unknown>;
  signal?: string | null;
  signalMetadata?: Record<string, unknown> | null;
  ephemeral?: boolean;
  sourceCommentId?: string | null;
  id?: string;
}): Promise<ActivityRow> {
  const now = new Date();
  const status = sessionStatusAfter(input.session.status as SessionStatus, input);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentActivity)
      .values({
        ...(input.id ? { id: input.id } : {}),
        sessionId: input.session.id,
        userId: input.userId,
        type: input.type,
        content: { ...input.content, type: input.type },
        signal: input.signal ?? null,
        signalMetadata: input.signalMetadata ?? null,
        ephemeral: input.ephemeral ?? false,
        sourceCommentId: input.sourceCommentId ?? null,
      })
      .returning();
    await tx
      .update(agentSession)
      .set(statusChange(status, now))
      .where(eq(agentSession.id, input.session.id));
    return created!;
  });
  if (input.type === 'elicitation' || status === 'complete')
    await notifyAgentSession({
      type: input.type === 'elicitation' ? 'agent_needs_input' : 'agent_responded',
      recipientId: input.session.creatorUserId,
      appUserId: input.session.appUserId,
      issueId: input.session.issueId,
      sessionId: input.session.id,
      activityId: row.id,
    });
  if (input.type === 'prompt')
    await emitAgentSessionEvent({
      action: 'prompted',
      sessionId: input.session.id,
      activityId: row.id,
    });
  return row;
}

// The app user's open session on the issue, if any (the newest).
async function openSession(issueId: string, appUserId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.issueId, issueId),
        eq(agentSession.appUserId, appUserId),
        isNull(agentSession.dismissedAt),
        inArray(agentSession.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(1);
  return row ?? null;
}

// An issue was delegated to an app user (the delegate changed to it): starts a
// pending session, or prompts the app's open session on the issue.
export async function issueDelegated(
  issueId: string,
  appUserId: string,
  actorUserId: string | null,
): Promise<void> {
  // An app delegating an issue to itself starts nothing.
  if (actorUserId === appUserId) return;
  const open = await openSession(issueId, appUserId);
  if (!open) {
    await startSession({ issueId, appUserId, creatorUserId: actorUserId, status: 'pending' });
    return;
  }
  if (!actorUserId) return;
  await addActivity({
    session: open,
    userId: actorUserId,
    type: 'prompt',
    content: { body: 'The issue was delegated to you again.' },
  });
}

// A comment was posted on an issue. Each installed app mentioned in it that was
// granted `app:mentionable` and can see the issue's team gets a session on the
// comment's thread, or a prompt on the session it already has there. A reply in a
// thread that has sessions is a prompt to each of those apps that is still installed
// (once per app, also when the reply mentions it). Comments written by app users start
// and prompt nothing.
export async function commentPosted(c: CommentRow, teamId: string): Promise<void> {
  if (!c.issueId || !c.userId) return;
  const [author] = await db
    .select({ role: userTable.workspaceRole })
    .from(userTable)
    .where(eq(userTable.id, c.userId));
  if (!author || author.role === APP_ROLE) return;
  const rootId = c.parentId ?? c.id;
  const threadSessions = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.commentId, rootId))
    .orderBy(asc(agentSession.createdAt));
  const sessionOf = (appUserId: string) => threadSessions.find((s) => s.appUserId === appUserId);
  const prompt = (session: SessionRow) =>
    addActivity({
      session,
      userId: c.userId!,
      type: 'prompt',
      content: { body: c.body },
      sourceCommentId: c.id,
    });

  const handled = new Set<string>();
  for (const appUserId of parseMentions(c.body)) {
    if (handled.has(appUserId)) continue;
    if (!(await appUserMay(appUserId, 'app:mentionable', teamId))) continue;
    handled.add(appUserId);
    const existing = sessionOf(appUserId);
    if (existing) await prompt(existing);
    else
      await startSession({
        issueId: c.issueId,
        appUserId,
        creatorUserId: c.userId,
        status: 'pending',
        commentId: rootId,
        sourceCommentId: c.id === rootId ? null : c.id,
      });
  }
  if (!c.parentId) return;
  for (const session of threadSessions) {
    if (handled.has(session.appUserId)) continue;
    handled.add(session.appUserId);
    if (await activeInstall(session.appUserId)) await prompt(session);
  }
}

// A person stops a session (Linear's stop signal): a `prompt` activity with the `stop`
// signal, which moves the session to `stopping` and sends the `prompted` event. The
// person must be able to read the session; an ended session cannot be stopped.
export async function stopSession(sessionId: string, userId: string): Promise<ActivityRow> {
  const [session] = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), await readableSessionsSql(userId)));
  if (!session) throw new HttpError(404, 'Agent session not found');
  if (!OPEN_STATUSES.includes(session.status as SessionStatus))
    throw new HttpError(400, 'The agent session has ended');
  return addActivity({
    session,
    userId,
    type: 'prompt',
    content: { body: 'Stop' },
    signal: 'stop',
  });
}

// Whether a comment already has a session (any app).
export async function commentHasSession(commentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: agentSession.id })
    .from(agentSession)
    .where(eq(agentSession.commentId, commentId))
    .limit(1);
  return !!row;
}

// --- Validation of agent input -----------------------------------------------------

function text(value: unknown, name: string, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `content.${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || (required && !value.trim()))
    throw new HttpError(400, `content.${name} must be a non-empty string`);
  if (value.length > MAX_TEXT)
    throw new HttpError(400, `content.${name} must be at most ${MAX_TEXT} characters`);
  return value;
}

// An agent's activity input (agentActivityCreate), checked against Linear's rules.
// Prompts and the stop signal are written by people and the server only.
export function agentActivityInput(input: {
  content: Record<string, unknown>;
  signal?: string | null;
  signalMetadata?: Record<string, unknown> | null;
  ephemeral?: boolean | null;
}): {
  type: ActivityType;
  content: Record<string, unknown>;
  signal: string | null;
  signalMetadata: Record<string, unknown> | null;
  ephemeral: boolean;
} {
  const type = input.content.type;
  if (typeof type !== 'string' || !(ACTIVITY_TYPES as readonly string[]).includes(type))
    throw new HttpError(
      400,
      'content.type must be thought, action, elicitation, response or error',
    );
  if (type === 'prompt') throw new HttpError(400, 'Prompts are written by people, not agents');
  let content: Record<string, unknown>;
  if (type === 'action') {
    const result = text(input.content.result, 'result', false);
    content = {
      action: text(input.content.action, 'action', true),
      parameter: text(input.content.parameter, 'parameter', true),
      ...(result !== undefined ? { result } : {}),
    };
  } else content = { body: text(input.content.body, 'body', true) };

  const signal = input.signal ?? null;
  if (signal === 'stop') throw new HttpError(400, 'The stop signal is reserved for user prompts');
  if (signal === 'continue' && type !== 'response')
    throw new HttpError(400, 'The continue signal is only for a response');
  if ((signal === 'auth' || signal === 'select') && type !== 'elicitation')
    throw new HttpError(400, `The ${signal} signal is only for an elicitation`);
  if (signal !== null && !['continue', 'auth', 'select'].includes(signal))
    throw new HttpError(400, 'signal is not supported');
  const signalMetadata = input.signalMetadata ?? null;
  if (signalMetadata && signal !== 'auth' && signal !== 'select')
    throw new HttpError(400, 'signalMetadata is only for the auth and select signals');
  if (signal === 'auth' && typeof signalMetadata?.url !== 'string')
    throw new HttpError(400, 'The auth signal needs signalMetadata.url');
  if (signal === 'select' && !Array.isArray(signalMetadata?.options))
    throw new HttpError(400, 'The select signal needs signalMetadata.options');

  const ephemeral = input.ephemeral ?? false;
  if (ephemeral && type !== 'thought' && type !== 'action')
    throw new HttpError(400, 'Only thought and action activities can be ephemeral');
  return { type: type as ActivityType, content, signal, signalMetadata, ephemeral };
}

const PLAN_STATUSES = ['pending', 'inProgress', 'completed', 'canceled'];

// Linear's plan input: 1 to 100 entries of { content, status }. Accepts the entries
// array or an object holding it under `entries`. Returns the stored plan.
export function planInput(value: unknown, now: Date): { entries: unknown[]; updatedAt: string } {
  const entries = Array.isArray(value) ? value : (value as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100)
    throw new HttpError(400, 'plan must hold 1 to 100 entries');
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const keys = Object.keys(e ?? {});
    if (
      !e ||
      keys.some((k) => k !== 'content' && k !== 'status') ||
      typeof e.content !== 'string' ||
      e.content.length < 1 ||
      e.content.length > 10_000 ||
      !PLAN_STATUSES.includes(e.status as string)
    )
      throw new HttpError(
        400,
        'Each plan entry needs content (1 to 10,000 characters) and status (pending, inProgress, completed or canceled)',
      );
  }
  return {
    entries: entries.map((e) => ({ content: e.content, status: e.status })),
    updatedAt: now.toISOString(),
  };
}

// Linear's external URL list: http(s) URLs, unique, each with a label.
export function externalUrlsInput(value: unknown, path: string): ExternalUrl[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${path} must be a list`);
  const seen = new Set<string>();
  return value.map((entry) => {
    const e = entry as Record<string, unknown>;
    if (typeof e?.url !== 'string' || !/^https?:\/\//i.test(e.url) || !URL.canParse(e.url))
      throw new HttpError(400, `${path} URLs must use http or https`);
    if (typeof e.label !== 'string') throw new HttpError(400, `${path} entries need a label`);
    if (seen.has(e.url)) throw new HttpError(400, `${path} URLs must be unique`);
    seen.add(e.url);
    return { url: e.url, label: e.label };
  });
}

// The app user's display name, the label Linear gives an externalLink.
export async function appUserName(appUserId: string): Promise<string> {
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, appUserId));
  return row?.name ?? 'Agent';
}

// Applies Linear's external URL changes (replace, or add / remove, and externalLink)
// to the current list.
export async function nextExternalUrls(
  current: ExternalUrl[],
  input: {
    externalUrls?: unknown;
    addedExternalUrls?: unknown;
    removedExternalUrls?: unknown;
    externalLink?: string | null;
  },
  appUserId: string,
): Promise<{ urls: ExternalUrl[]; externalLink?: string | null }> {
  const incremental = input.addedExternalUrls != null || input.removedExternalUrls != null;
  if (input.externalUrls != null && incremental)
    throw new HttpError(
      400,
      'externalUrls cannot be combined with addedExternalUrls or removedExternalUrls',
    );
  let urls = [...current];
  if (input.externalUrls != null) urls = externalUrlsInput(input.externalUrls, 'externalUrls');
  const removed = input.removedExternalUrls == null ? [] : (input.removedExternalUrls as unknown[]);
  if (!Array.isArray(removed) || removed.some((u) => typeof u !== 'string'))
    throw new HttpError(400, 'removedExternalUrls must be a list of URLs');
  const added =
    input.addedExternalUrls == null
      ? []
      : externalUrlsInput(input.addedExternalUrls, 'addedExternalUrls');
  if (added.some((a) => removed.includes(a.url)))
    throw new HttpError(400, 'A URL cannot be added and removed in the same request');
  urls = urls.filter((u) => !removed.includes(u.url));
  for (const a of added) {
    const i = urls.findIndex((u) => u.url === a.url);
    if (i >= 0) urls[i] = a;
    else urls.push(a);
  }
  let externalLink: string | null | undefined;
  if (input.externalLink !== undefined) {
    externalLink = input.externalLink;
    if (externalLink !== null) {
      const [link] = externalUrlsInput(
        [{ url: externalLink, label: await appUserName(appUserId) }],
        'externalLink',
      );
      if (!urls.some((u) => u.url === link!.url)) urls.push(link!);
    }
  }
  return { urls, externalLink };
}

// Writes a session update; `acknowledge` makes a pending or stale session active.
export async function updateSession(
  session: SessionRow,
  set: Partial<typeof agentSession.$inferInsert>,
  acknowledge: boolean,
): Promise<SessionRow> {
  const now = new Date();
  const next: Partial<typeof agentSession.$inferInsert> = { ...set, updatedAt: now };
  if (acknowledge && (session.status === 'pending' || session.status === 'stale'))
    Object.assign(next, statusChange('active', now));
  const [row] = await db
    .update(agentSession)
    .set(next)
    .where(eq(agentSession.id, session.id))
    .returning();
  return row!;
}

// The root comment of a thread, when it is an issue comment without a session.
export async function assertSessionThread(c: CommentRow): Promise<void> {
  if (!c.issueId) throw new HttpError(400, 'The comment must be on an issue');
  if (c.parentId) throw new HttpError(400, 'The comment must be a root comment, not a reply');
  if (await commentHasSession(c.id))
    throw new HttpError(400, 'The comment already has an agent session');
}
