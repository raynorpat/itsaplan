import { beforeEach, describe, expect, it } from 'bun:test';
import { db, webhook } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import {
  authPost,
  bearer,
  createClient,
  install,
  uninstall,
  type OAuthClient,
} from '../../../__tests__/helpers/oauth';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Linear's agent session events: a session's app receives an `AgentSessionEvent`
// webhook when the session starts (`created`) and when a person writes to it
// (`prompted`: a reply in the session's thread, or Stop). The creator of a session is
// notified when the agent asks for input or answers. Uninstalling the app ends its
// open sessions.

const VIEWER = '{ viewer { id } }';
const ISSUE_CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier } }
}`;
const ISSUE_UPDATE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;
const COMMENT_CREATE = `mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { id } }
}`;
const SESSIONS = `{ agentSessions { nodes { id status comment { id }
  activities { nodes { id signal content { __typename ... on AgentActivityPromptContent { body } } } } } } }`;
const SESSION = `query($id: String!) { agentSession(id: $id) { id status endedAt
  activities { nodes { id signal content { __typename } } } } }`;
const ACTIVITY_CREATE = `mutation($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) { success agentActivity { id } }
}`;
const NOTIFICATIONS = `{ notifications { nodes { __typename type category
  ... on AgentSessionNotification { agentSessionId agentActivityId actor { id } } } } }`;

type Res = Awaited<ReturnType<typeof gql>>;

interface Agent {
  client: OAuthClient;
  userId: string;
  headers: Record<string, string>;
  webhookId: string | null;
}

interface Session {
  id: string;
  status: string;
  comment: { id: string } | null;
  activities: { nodes: { id: string; signal: string | null; content: { __typename: string } }[] };
}

async function installAgent(
  owner: TestUser,
  name: string,
  withWebhook = true,
  teamIds: string[] = [],
): Promise<Agent> {
  const client = await createClient(
    owner.cookie,
    withWebhook
      ? {
          name,
          webhookUrl: 'https://agent.example.com/linear',
          // Agent events reach the app whatever resource types it subscribes to.
          webhookResourceTypes: ['Project'],
        }
      : { name },
  );
  const tokens = await install(owner.cookie, client, {
    scope: 'read,write,app:assignable,app:mentionable',
    teamIds,
  });
  const headers = bearer(tokens.access_token);
  const me = await gql(headers, VIEWER);
  const [row] = await db
    .select({ id: webhook.id })
    .from(webhook)
    .where(eq(webhook.oauthClientId, client.clientId));
  return {
    client,
    userId: (me.body.data?.viewer as { id: string }).id,
    headers,
    webhookId: row?.id ?? null,
  };
}

async function createIssue(who: TestUser): Promise<{ id: string; identifier: string }> {
  const res = await gql({ cookie: who.cookie }, ISSUE_CREATE, {
    input: { teamId: 'ENG', title: 'Fix the login page', description: 'It times out.' },
  });
  return (res.body.data?.issueCreate as { issue: { id: string; identifier: string } }).issue;
}

const delegate = (who: TestUser, issueId: string, delegateId: string) =>
  gql({ cookie: who.cookie }, ISSUE_UPDATE, { id: issueId, input: { delegateId } });

const comment = (headers: Record<string, string>, input: Record<string, unknown>) =>
  gql(headers, COMMENT_CREATE, { input });

const commentId = (res: Res) =>
  (res.body.data?.commentCreate as { comment: { id: string } }).comment.id;

const mention = (userId: string, text: string) => `@[Agent](user:${userId}) ${text}`;

async function sessions(headers: Record<string, string>): Promise<Session[]> {
  const res = await gql(headers, SESSIONS);
  expect(res.body.errors).toBeUndefined();
  return (res.body.data?.agentSessions as { nodes: Session[] }).nodes;
}

interface AgentEvent {
  type: string;
  action: string;
  appUserId: string;
  oauthClientId: string;
  organizationId: string;
  webhookId: string;
  createdAt: string;
  promptContext?: string;
  previousComments?: { id: string; body: string }[];
  guidance?: unknown[];
  agentSession: Record<string, unknown> & { id: string };
  agentActivity?: Record<string, unknown> & { id: string; signal: string | null };
}

// The AgentSessionEvent deliveries queued for the agent's webhook, oldest first.
async function events(agent: Agent): Promise<AgentEvent[]> {
  const { data } = await webhookDeliveries(agent.webhookId!);
  return data.items
    .filter((d) => d.eventType === 'AgentSessionEvent')
    .map((d) => d.payload as AgentEvent)
    .reverse();
}

const activity = (agent: Agent, agentSessionId: string, content: Record<string, unknown>) =>
  gql(agent.headers, ACTIVITY_CREATE, { input: { agentSessionId, content } });

const stop = (cookie: string, sessionId: string) =>
  authPost('/instance/agent-session-stop', cookie, { sessionId });

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpTestUser({ name: 'Member' });
  const api = authedApi(owner.cookie);
  await api.teams.post({ key: 'ENG', name: 'Engineering' });
  await api.teams.post({ key: 'PRV', name: 'Private' });
  await api.teams({ teamKey: 'PRV' }).patch({ visibility: 'private' });
  const robot = await installAgent(owner, 'Robot');
  return { owner, member, robot };
}

describe('agent session webhooks', () => {
  beforeEach(resetDb);

  it('sends one created event to the app when an issue is delegated to it', async () => {
    const { owner, robot } = await setup();
    const issue = await createIssue(owner);
    expect((await delegate(owner, issue.id, robot.userId)).body.errors).toBeUndefined();

    const sent = await events(robot);
    expect(sent).toHaveLength(1);
    const [event] = sent;
    const [session] = await sessions(robot.headers);
    expect(event).toMatchObject({
      type: 'AgentSessionEvent',
      action: 'created',
      appUserId: robot.userId,
      oauthClientId: robot.client.clientId,
      webhookId: robot.webhookId,
      agentSession: {
        id: session!.id,
        appUserId: robot.userId,
        issueId: issue.id,
        commentId: session!.comment!.id,
        creatorId: owner.userId,
        creator: { id: owner.userId, name: 'Owner' },
        status: 'pending',
        issue: {
          id: issue.id,
          identifier: issue.identifier,
          title: 'Fix the login page',
          description: 'It times out.',
          team: { key: 'ENG' },
        },
        comment: { id: session!.comment!.id, issueId: issue.id },
      },
    });
    expect(event!.organizationId).toBeString();
    expect(event!.agentActivity).toBeUndefined();
    expect(event!.promptContext).toContain(issue.identifier);
    expect(event!.promptContext).toContain('Fix the login page');
  });

  it('starts sessions without events when the app has no webhook', async () => {
    const { owner } = await setup();
    const silent = await installAgent(owner, 'Silent', false);
    const issue = await createIssue(owner);
    expect((await delegate(owner, issue.id, silent.userId)).body.errors).toBeUndefined();
    expect(await sessions(silent.headers)).toHaveLength(1);
  });

  it('sends the earlier comments of the thread when the app is mentioned in a reply', async () => {
    const { owner, member, robot } = await setup();
    const issue = await createIssue(owner);
    const root = commentId(
      await comment({ cookie: owner.cookie }, { issueId: issue.id, body: 'Login fails on Safari' }),
    );
    await comment({ cookie: member.cookie }, { issueId: issue.id, parentId: root, body: 'Me too' });
    await comment(
      { cookie: owner.cookie },
      { issueId: issue.id, parentId: root, body: mention(robot.userId, 'can you look?') },
    );

    const [event] = await events(robot);
    expect(event).toMatchObject({ action: 'created', agentSession: { commentId: root } });
    expect(event!.previousComments!.map((c) => c.body)).toEqual([
      'Login fails on Safari',
      'Me too',
    ]);
  });

  it("sends exactly one prompted event for a person's reply, none for the agent's own", async () => {
    const { owner, robot } = await setup();
    const issue = await createIssue(owner);
    await delegate(owner, issue.id, robot.userId);
    const [session] = await sessions(robot.headers);
    const thread = session!.comment!.id;

    // The agent's own comment in its thread prompts nothing.
    await comment(robot.headers, { issueId: issue.id, parentId: thread, body: 'Working on it' });
    expect(await events(robot)).toHaveLength(1);

    // A person's plain reply becomes one prompt.
    const reply = commentId(
      await comment(
        { cookie: owner.cookie },
        { issueId: issue.id, parentId: thread, body: 'Use the new API' },
      ),
    );
    const sent = await events(robot);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      action: 'prompted',
      agentSession: { id: session!.id, status: 'pending' },
      agentActivity: {
        agentSessionId: session!.id,
        userId: owner.userId,
        sourceCommentId: reply,
        content: { type: 'prompt', body: 'Use the new API' },
        signal: null,
      },
    });

    // A reply that also mentions the agent is still one prompt.
    await comment(
      { cookie: owner.cookie },
      { issueId: issue.id, parentId: thread, body: mention(robot.userId, 'and add tests') },
    );
    expect(await events(robot)).toHaveLength(3);
    const prompts = (await sessions(robot.headers))[0]!.activities.nodes.filter(
      (a) => a.content.__typename === 'AgentActivityPromptContent',
    );
    expect(prompts).toHaveLength(2);
  });

  it('stops a session with a stop prompt for anyone who can see the issue', async () => {
    const { owner, member, robot } = await setup();
    const issue = await createIssue(owner);
    await delegate(owner, issue.id, robot.userId);
    const [session] = await sessions(robot.headers);

    // Another site cannot stop it through a signed-in browser.
    const foreign = await app.handle(
      new Request('http://localhost/api/auth/instance/agent-session-stop', {
        method: 'POST',
        headers: {
          cookie: member.cookie,
          origin: 'https://evil.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sessionId: session!.id }),
      }),
    );
    expect(foreign.status).toBe(403);

    const res = await stop(member.cookie, session!.id);
    expect(res.status).toBe(200);
    const sent = await events(robot);
    expect(sent.at(-1)).toMatchObject({
      action: 'prompted',
      agentSession: { status: 'stopping' },
      agentActivity: { signal: 'stop', userId: member.userId, content: { type: 'prompt' } },
    });

    // An ended session cannot be stopped.
    await activity(robot, session!.id, { type: 'response', body: 'Stopped.' });
    expect((await stop(member.cookie, session!.id)).status).toBe(400);
  });

  it('refuses to stop a session on an issue the person cannot see', async () => {
    const { owner, member } = await setup();
    const prvTeam = await gql({ cookie: owner.cookie }, 'query { team(id: "PRV") { id } }');
    const prv = await installAgent(owner, 'Private agent', true, [
      (prvTeam.body.data?.team as { id: string }).id,
    ]);
    const res = await gql({ cookie: owner.cookie }, ISSUE_CREATE, {
      input: { teamId: 'PRV', title: 'Secret' },
    });
    const issueId = (res.body.data?.issueCreate as { issue: { id: string } }).issue.id;
    expect((await delegate(owner, issueId, prv.userId)).body.errors).toBeUndefined();
    const headers = prv.headers;
    const [session] = await sessions(headers);

    expect((await stop(member.cookie, session!.id)).status).toBe(404);
    expect((await stop(owner.cookie, 'not-a-session')).status).toBe(400);
  });

  it('notifies the creator when the agent asks for input or answers', async () => {
    const { owner, member, robot } = await setup();
    const issue = await createIssue(owner);
    await delegate(member, issue.id, robot.userId);
    const [session] = await sessions(robot.headers);

    await activity(robot, session!.id, { type: 'thought', body: 'Looking' });
    const asked = await activity(robot, session!.id, {
      type: 'elicitation',
      body: 'Which browser?',
    });
    const answered = await activity(robot, session!.id, { type: 'response', body: 'Fixed.' });

    const res = await gql({ cookie: member.cookie }, NOTIFICATIONS);
    expect(res.body.errors).toBeUndefined();
    const nodes = (res.body.data?.notifications as { nodes: Record<string, unknown>[] }).nodes;
    const agentNodes = nodes.filter((n) => n.__typename === 'AgentSessionNotification');
    expect(agentNodes).toHaveLength(2);
    const activityIds = agentNodes.map((n) => n.agentActivityId).sort();
    expect(activityIds).toEqual(
      [
        (asked.body.data?.agentActivityCreate as { agentActivity: { id: string } }).agentActivity
          .id,
        (answered.body.data?.agentActivityCreate as { agentActivity: { id: string } }).agentActivity
          .id,
      ].sort(),
    );
    for (const n of agentNodes)
      expect(n).toMatchObject({ agentSessionId: session!.id, actor: { id: robot.userId } });

    // The issue's owner, who did not start the session, is not told.
    const ownerRes = await gql({ cookie: owner.cookie }, NOTIFICATIONS);
    const ownerNodes = (ownerRes.body.data?.notifications as { nodes: { __typename: string }[] })
      .nodes;
    expect(ownerNodes.filter((n) => n.__typename === 'AgentSessionNotification')).toHaveLength(0);
  });

  it('ends the open sessions of an uninstalled app and sends no more events', async () => {
    const { owner, robot } = await setup();
    const issue = await createIssue(owner);
    await delegate(owner, issue.id, robot.userId);
    const [session] = await sessions(robot.headers);
    const before = (await events(robot)).length;

    expect((await uninstall(owner.cookie, robot.client)).status).toBe(200);

    const read = await gql({ cookie: owner.cookie }, SESSION, { id: session!.id });
    expect(read.body.errors).toBeUndefined();
    const ended = read.body.data?.agentSession as { status: string; endedAt: string | null };
    expect(ended.status).toBe('stale');
    expect(ended.endedAt).not.toBeNull();

    await comment(
      { cookie: owner.cookie },
      { issueId: issue.id, parentId: session!.comment!.id, body: 'Are you there?' },
    );
    expect((await events(robot)).length).toBe(before);
    expect((await stop(owner.cookie, session!.id)).status).toBe(400);
  });
});
