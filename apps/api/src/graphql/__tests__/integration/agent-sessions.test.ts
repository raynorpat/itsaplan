import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { bearer, createClient, install, uninstall } from '../../../__tests__/helpers/oauth';

// Linear's agent API: an issue delegated to an app user, or an app user @-mentioned
// in a comment, starts an agent session; the app publishes activities to its own
// sessions, which move the session through Linear's statuses. Anyone who can see the
// issue reads its sessions; an app reads only its own.

const TEAM = 'query($id: String!) { team(id: $id) { id } }';
const VIEWER = '{ viewer { id } }';
const ISSUE_CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier delegate { id } } }
}`;
const ISSUE_UPDATE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { delegate { id } } }
}`;
const ISSUE_DELEGATE = 'query($id: String!) { issue(id: $id) { delegate { id } } }';
const COMMENT_CREATE = `mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { id agentSession { id } } }
}`;
const SESSION_FIELDS = `id status slugId startedAt endedAt summary plan
  externalLinks { url label } externalUrls
  appUser { id app } creator { id } issue { id } comment { id } sourceComment { id }
  activities { nodes { id ephemeral signal user { id } promptAuthor { id } sourceComment { id }
    content { __typename
      ... on AgentActivityThoughtContent { body type }
      ... on AgentActivityActionContent { action parameter result type }
      ... on AgentActivityPromptContent { body type }
      ... on AgentActivityResponseContent { body type }
      ... on AgentActivityElicitationContent { body type }
      ... on AgentActivityErrorContent { body type } } } }`;
const SESSIONS = `{ agentSessions { nodes { ${SESSION_FIELDS} } } }`;
const SESSION = `query($id: String!) { agentSession(id: $id) { ${SESSION_FIELDS} } }`;
const ACTIVITIES = `query($filter: AgentActivityFilter) {
  agentActivities(filter: $filter) { nodes { id agentSession { id } content { __typename } } }
}`;
const CREATE_ON_ISSUE = `mutation($input: AgentSessionCreateOnIssue!) {
  agentSessionCreateOnIssue(input: $input) { success agentSession { ${SESSION_FIELDS} } }
}`;
const CREATE_ON_COMMENT = `mutation($input: AgentSessionCreateOnComment!) {
  agentSessionCreateOnComment(input: $input) { success agentSession { id status comment { id } } }
}`;
const ACTIVITY_CREATE = `mutation($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) {
    success agentActivity { id ephemeral signal agentSession { id status startedAt endedAt } }
  }
}`;
const SESSION_UPDATE = `mutation($id: String!, $input: AgentSessionUpdateInput!) {
  agentSessionUpdate(id: $id, input: $input) { success agentSession { ${SESSION_FIELDS} } }
}`;
const EXTERNAL_URL_UPDATE = `mutation($id: String!, $input: AgentSessionUpdateExternalUrlInput!) {
  agentSessionUpdateExternalUrl(id: $id, input: $input) {
    success agentSession { status externalLinks { url label } }
  }
}`;

type Res = Awaited<ReturnType<typeof gql>>;
const code = (res: Res) => res.body.errors?.[0]?.extensions?.code;

interface Session {
  id: string;
  status: string;
  slugId: string;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  plan: unknown;
  externalLinks: { url: string; label: string }[];
  externalUrls: string;
  appUser: { id: string; app: boolean };
  creator: { id: string } | null;
  issue: { id: string } | null;
  comment: { id: string } | null;
  sourceComment: { id: string } | null;
  activities: {
    nodes: {
      id: string;
      user: { id: string };
      promptAuthor: { id: string } | null;
      sourceComment: { id: string } | null;
      content: { __typename: string; body?: string; type: string };
    }[];
  };
}

interface App {
  token: string;
  userId: string;
  headers: Record<string, string>;
}

async function teamId(owner: TestUser, key: string): Promise<string> {
  const res = await gql({ cookie: owner.cookie }, TEAM, { id: key });
  return (res.body.data?.team as { id: string }).id;
}

async function installApp(
  owner: TestUser,
  name: string,
  scope: string,
  teamIds: string[] = [],
): Promise<App> {
  const client = await createClient(owner.cookie, { name });
  const tokens = await install(owner.cookie, client, { scope, teamIds });
  const headers = bearer(tokens.access_token);
  const me = await gql(headers, VIEWER);
  return {
    token: tokens.access_token,
    userId: (me.body.data?.viewer as { id: string }).id,
    headers,
  };
}

async function createIssue(who: TestUser, teamKey: string): Promise<string> {
  const res = await gql({ cookie: who.cookie }, ISSUE_CREATE, {
    input: { teamId: teamKey, title: 'Fix the login page' },
  });
  return (res.body.data?.issueCreate as { issue: { id: string } }).issue.id;
}

const delegate = (who: TestUser, issueId: string, delegateId: string | null) =>
  gql({ cookie: who.cookie }, ISSUE_UPDATE, { id: issueId, input: { delegateId } });

async function sessionsOf(headers: Record<string, string>): Promise<Session[]> {
  const res = await gql(headers, SESSIONS);
  expect(res.body.errors).toBeUndefined();
  return (res.body.data?.agentSessions as { nodes: Session[] }).nodes;
}

const mention = (userId: string, text: string) => `@[Agent](user:${userId}) ${text}`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpTestUser({ name: 'Member' });
  const api = authedApi(owner.cookie);
  await api.teams.post({ key: 'ENG', name: 'Engineering' });
  await api.teams.post({ key: 'SEC', name: 'Security' });
  await api.teams({ teamKey: 'SEC' }).patch({ visibility: 'private' });
  await api.teams.post({ key: 'PRV', name: 'Private' });
  await api.teams({ teamKey: 'PRV' }).patch({ visibility: 'private' });
  const sec = await teamId(owner, 'SEC');
  // Robot: assignable and mentionable, sees the public teams and SEC.
  const robot = await installApp(owner, 'Robot', 'read,write,app:assignable,app:mentionable', [
    sec,
  ]);
  // Helper: neither assignable nor mentionable.
  const helper = await installApp(owner, 'Helper', 'read,write');
  return { owner, member, robot, helper };
}

const activity = (app: App, agentSessionId: string, content: Record<string, unknown>, extra = {}) =>
  gql(app.headers, ACTIVITY_CREATE, { input: { agentSessionId, content, ...extra } });

describe('agent sessions', () => {
  beforeEach(resetDb);

  it('delegates an issue only to an assignable app user that can see its team', async () => {
    const { owner, member, robot, helper } = await setup();
    const issueId = await createIssue(owner, 'ENG');

    const ok = await delegate(owner, issueId, robot.userId);
    expect(ok.body.errors).toBeUndefined();
    expect(ok.body.data?.issueUpdate).toMatchObject({ issue: { delegate: { id: robot.userId } } });

    // Not granted app:assignable, a person, an app that cannot see the team.
    for (const id of [helper.userId, member.userId]) {
      const res = await delegate(owner, issueId, id);
      expect(code(res)).toBe('INVALID_INPUT');
    }
    const prv = await createIssue(owner, 'PRV');
    expect(code(await delegate(owner, prv, robot.userId))).toBe('INVALID_INPUT');
    // On create too.
    const created = await gql({ cookie: owner.cookie }, ISSUE_CREATE, {
      input: { teamId: 'PRV', title: 'x', delegateId: robot.userId },
    });
    expect(code(created)).toBe('INVALID_INPUT');

    // The delegate is unchanged by the refused updates.
    const read = await gql({ cookie: owner.cookie }, ISSUE_DELEGATE, { id: issueId });
    expect(read.body.data?.issue).toMatchObject({ delegate: { id: robot.userId } });
  });

  it('refuses an uninstalled application as delegate', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await authedApi(owner.cookie).teams.post({ key: 'ENG', name: 'Engineering' });
    const client = await createClient(owner.cookie, { name: 'Gone' });
    const tokens = await install(owner.cookie, client, { scope: 'read,write,app:assignable' });
    const me = await gql(bearer(tokens.access_token), VIEWER);
    const appUserId = (me.body.data?.viewer as { id: string }).id;
    expect((await uninstall(owner.cookie, client)).status).toBe(200);
    const issueId = await createIssue(owner, 'ENG');
    expect(code(await delegate(owner, issueId, appUserId))).toBe('INVALID_INPUT');
  });

  it('starts one pending session on delegation and prompts it on a second delegation', async () => {
    const { owner, robot } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    await delegate(owner, issueId, robot.userId);

    let sessions = await sessionsOf(robot.headers);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      status: 'pending',
      appUser: { id: robot.userId, app: true },
      creator: { id: owner.userId },
      issue: { id: issueId },
    });
    expect(sessions[0]!.comment).not.toBeNull();
    expect(sessions[0]!.slugId).toBeTruthy();

    // Delegating again while the session is open prompts it instead.
    await delegate(owner, issueId, null);
    await delegate(owner, issueId, robot.userId);
    sessions = await sessionsOf(robot.headers);
    expect(sessions).toHaveLength(1);
    const prompts = sessions[0]!.activities.nodes.filter(
      (a) => a.content.__typename === 'AgentActivityPromptContent',
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      user: { id: owner.userId },
      promptAuthor: { id: owner.userId },
    });
  });

  it('starts a comment session on a mention of a mentionable app, and prompts it on another', async () => {
    const { owner, robot, helper } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    const root = await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, body: mention(robot.userId, 'please look') },
    });
    const rootId = (root.body.data?.commentCreate as { comment: { id: string } }).comment.id;

    let sessions = await sessionsOf(robot.headers);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      status: 'pending',
      comment: { id: rootId },
      creator: { id: owner.userId },
      issue: { id: issueId },
    });
    // Comment.agentSession
    const read = await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, body: 'unrelated' },
    });
    expect(read.body.data?.commentCreate).toMatchObject({ comment: { agentSession: null } });

    // A mention of an app without app:mentionable starts nothing.
    await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, body: mention(helper.userId, 'hi') },
    });
    expect(await sessionsOf(helper.headers)).toHaveLength(0);

    // Mentioning the app again in the same thread prompts its session.
    const reply = await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, parentId: rootId, body: mention(robot.userId, 'and this') },
    });
    const replyId = (reply.body.data?.commentCreate as { comment: { id: string } }).comment.id;
    sessions = await sessionsOf(robot.headers);
    expect(sessions).toHaveLength(1);
    const prompt = sessions[0]!.activities.nodes.find(
      (a) => a.content.__typename === 'AgentActivityPromptContent',
    );
    expect(prompt).toMatchObject({
      sourceComment: { id: replyId },
      user: { id: owner.userId },
      content: { type: 'prompt' },
    });
    expect(prompt!.content.body).toContain('and this');
  });

  it('starts sessions on an issue or a comment for the calling app only', async () => {
    const { owner, robot } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    const res = await gql(robot.headers, CREATE_ON_ISSUE, {
      input: { issueId, externalUrls: [{ url: 'https://agent.example.com/s/1', label: 'Run' }] },
    });
    expect(res.body.errors).toBeUndefined();
    const session = (res.body.data?.agentSessionCreateOnIssue as { agentSession: Session })
      .agentSession;
    expect(session).toMatchObject({
      status: 'active',
      appUser: { id: robot.userId },
      issue: { id: issueId },
      creator: null,
      externalLinks: [{ url: 'https://agent.example.com/s/1', label: 'Run' }],
    });
    expect(session.comment).not.toBeNull();

    // A person cannot start an agent session.
    expect(code(await gql({ cookie: owner.cookie }, CREATE_ON_ISSUE, { input: { issueId } }))).toBe(
      'FORBIDDEN',
    );

    // On an existing root comment; not on a reply or a comment with a session.
    const root = await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, body: 'Can someone look?' },
    });
    const rootId = (root.body.data?.commentCreate as { comment: { id: string } }).comment.id;
    const reply = await gql({ cookie: owner.cookie }, COMMENT_CREATE, {
      input: { issueId, parentId: rootId, body: 'Me too' },
    });
    const replyId = (reply.body.data?.commentCreate as { comment: { id: string } }).comment.id;
    const onComment = await gql(robot.headers, CREATE_ON_COMMENT, { input: { commentId: rootId } });
    expect(onComment.body.data?.agentSessionCreateOnComment).toMatchObject({
      agentSession: { status: 'active', comment: { id: rootId } },
    });
    expect(
      code(await gql(robot.headers, CREATE_ON_COMMENT, { input: { commentId: rootId } })),
    ).toBe('INVALID_INPUT');
    expect(
      code(await gql(robot.headers, CREATE_ON_COMMENT, { input: { commentId: replyId } })),
    ).toBe('INVALID_INPUT');
  });

  it('moves the session through Linear statuses as the app publishes activities', async () => {
    const { owner, robot } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    await delegate(owner, issueId, robot.userId);
    const [session] = await sessionsOf(robot.headers);
    const id = session!.id;

    const steps: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{ type: 'thought', body: 'Reading the code' }, { ephemeral: true }, 'active'],
      [{ type: 'action', action: 'Searching', parameter: 'login.ts' }, {}, 'active'],
      [{ type: 'elicitation', body: 'Which browser?' }, {}, 'awaitingInput'],
      [{ type: 'response', body: 'Working on it' }, { signal: 'continue' }, 'active'],
      [{ type: 'response', body: 'Fixed in #12' }, {}, 'complete'],
      [{ type: 'error', body: 'The build failed' }, {}, 'error'],
    ];
    for (const [content, extra, status] of steps) {
      const res = await activity(robot, id, content, extra);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data?.agentActivityCreate).toMatchObject({
        success: true,
        agentActivity: { agentSession: { id, status } },
      });
    }

    const read = await gql(robot.headers, SESSION, { id });
    const s = read.body.data?.agentSession as Session;
    expect(s.startedAt).not.toBeNull();
    expect(s.activities.nodes.map((a) => a.content.__typename).sort()).toEqual(
      [
        'AgentActivityActionContent',
        'AgentActivityElicitationContent',
        'AgentActivityErrorContent',
        'AgentActivityResponseContent',
        'AgentActivityResponseContent',
        'AgentActivityThoughtContent',
      ].sort(),
    );
    // The session reads by slug too.
    const bySlug = await gql(robot.headers, SESSION, { id: s.slugId });
    expect((bySlug.body.data?.agentSession as Session).id).toBe(id);
  });

  it('refuses activities Linear does not accept', async () => {
    const { owner, robot } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    await delegate(owner, issueId, robot.userId);
    const [session] = await sessionsOf(robot.headers);
    const id = session!.id;
    const refused: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ type: 'prompt', body: 'hi' }, {}],
      [{ type: 'response', body: 'done' }, { signal: 'stop' }],
      [{ type: 'response', body: 'done' }, { ephemeral: true }],
      [{ type: 'thought', body: 'x' }, { signal: 'continue' }],
      [{ type: 'thought' }, {}],
      [{ type: 'action', action: 'Searching' }, {}],
      [{ type: 'dance', body: 'x' }, {}],
    ];
    for (const [content, extra] of refused)
      expect(code(await activity(robot, id, content, extra))).toBe('INVALID_INPUT');
    // A person cannot publish to the session.
    const person = await gql({ cookie: owner.cookie }, ACTIVITY_CREATE, {
      input: { agentSessionId: id, content: { type: 'thought', body: 'x' } },
    });
    expect(code(person)).toBe('FORBIDDEN');
  });

  it("keeps one app out of another app's session", async () => {
    const { owner, robot, helper } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    await delegate(owner, issueId, robot.userId);
    const [session] = await sessionsOf(robot.headers);
    const id = session!.id;
    await activity(robot, id, { type: 'thought', body: 'Mine' });

    expect(code(await activity(helper, id, { type: 'thought', body: 'Mine now' }))).toBe(
      'ENTITY_NOT_FOUND',
    );
    expect(code(await gql(helper.headers, SESSION_UPDATE, { id, input: { summary: 'x' } }))).toBe(
      'ENTITY_NOT_FOUND',
    );
    expect(code(await gql(helper.headers, SESSION, { id }))).toBe('ENTITY_NOT_FOUND');
    expect(await sessionsOf(helper.headers)).toHaveLength(0);
    const acts = await gql(helper.headers, ACTIVITIES, {
      filter: { agentSessionId: { eq: id } },
    });
    expect((acts.body.data?.agentActivities as { nodes: unknown[] }).nodes).toHaveLength(0);
  });

  it('shows sessions to the people who can see the issue', async () => {
    const { owner, member, robot } = await setup();
    const eng = await createIssue(owner, 'ENG');
    const sec = await createIssue(owner, 'SEC');
    await delegate(owner, eng, robot.userId);
    await delegate(owner, sec, robot.userId);
    const sessions = await sessionsOf(robot.headers);
    expect(sessions).toHaveLength(2);
    const secSession = sessions.find((s) => s.issue?.id === sec)!;
    const engSession = sessions.find((s) => s.issue?.id === eng)!;
    await activity(robot, engSession.id, { type: 'thought', body: 'Looking' });

    // The owner sees both; a member outside the private team only the public one.
    expect(await sessionsOf({ cookie: owner.cookie })).toHaveLength(2);
    const mine = await sessionsOf({ cookie: member.cookie });
    expect(mine.map((s) => s.id)).toEqual([engSession.id]);
    expect(mine[0]!.activities.nodes).toHaveLength(1);
    expect(code(await gql({ cookie: member.cookie }, SESSION, { id: secSession.id }))).toBe(
      'ENTITY_NOT_FOUND',
    );
    const acts = await gql({ cookie: member.cookie }, ACTIVITIES, {
      filter: { agentSessionId: { in: [secSession.id, engSession.id] } },
    });
    expect((acts.body.data?.agentActivities as { nodes: unknown[] }).nodes).toHaveLength(1);
  });

  it('updates plan, title and links; a title-only update does not acknowledge the session', async () => {
    const { owner, robot } = await setup();
    const issueId = await createIssue(owner, 'ENG');
    await delegate(owner, issueId, robot.userId);
    const [session] = await sessionsOf(robot.headers);
    const id = session!.id;

    const titled = await gql(robot.headers, SESSION_UPDATE, {
      id,
      input: { summary: 'Login fix' },
    });
    expect(titled.body.data?.agentSessionUpdate).toMatchObject({
      agentSession: { summary: 'Login fix', status: 'pending' },
    });

    const plan = [
      { content: 'Reproduce', status: 'completed' },
      { content: 'Fix', status: 'inProgress' },
    ];
    const planned = await gql(robot.headers, SESSION_UPDATE, {
      id,
      input: { plan, externalUrls: [{ url: 'https://agent.example.com/r/9', label: 'Run' }] },
    });
    expect(planned.body.errors).toBeUndefined();
    const s = (planned.body.data?.agentSessionUpdate as { agentSession: Session }).agentSession;
    expect(s.status).toBe('active');
    expect((s.plan as { entries: unknown[] }).entries).toEqual(plan);
    expect(s.externalLinks).toEqual([{ url: 'https://agent.example.com/r/9', label: 'Run' }]);
    expect(JSON.parse(s.externalUrls)).toEqual(s.externalLinks);

    const added = await gql(robot.headers, EXTERNAL_URL_UPDATE, {
      id,
      input: { addedExternalUrls: [{ url: 'https://agent.example.com/pr/3', label: 'PR' }] },
    });
    expect(added.body.data?.agentSessionUpdateExternalUrl).toMatchObject({
      agentSession: {
        externalLinks: [
          { url: 'https://agent.example.com/r/9', label: 'Run' },
          { url: 'https://agent.example.com/pr/3', label: 'PR' },
        ],
      },
    });

    // The creator may retitle; not change the plan.
    const byCreator = await gql({ cookie: owner.cookie }, SESSION_UPDATE, {
      id,
      input: { summary: 'Renamed' },
    });
    expect(byCreator.body.data?.agentSessionUpdate).toMatchObject({
      agentSession: { summary: 'Renamed' },
    });
    expect(code(await gql({ cookie: owner.cookie }, SESSION_UPDATE, { id, input: { plan } }))).toBe(
      'FORBIDDEN',
    );
    // A plan entry outside Linear's shape is refused.
    expect(
      code(
        await gql(robot.headers, SESSION_UPDATE, {
          id,
          input: { plan: [{ content: 'x', status: 'later' }] },
        }),
      ),
    ).toBe('INVALID_INPUT');
  });
});
