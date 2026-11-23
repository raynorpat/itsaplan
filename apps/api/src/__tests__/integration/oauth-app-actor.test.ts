import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { app } from '../../app';
import { authedApi } from '../helpers/app';
import { requestMagicLink, signUpTestUser, type TestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gql } from '../helpers/linear';
import {
  REDIRECT_URI,
  authPost,
  authorizeRequest,
  createClient,
  obtainTokens,
  pkce,
  redirectTarget,
  tokenRequest,
  type OAuthClient,
  type TokenSet,
} from '../helpers/oauth';
import { signUpWithRole } from '../helpers/roles';

// Installing an OAuth application with `actor=app` (Linear's app actor): only workspace
// admins and owners install; the install creates one app user per application, which
// tokens of the install act as. The app user sees only the teams chosen at install,
// never has admin rights, cannot sign in, and is kept out of member lists. The
// `client_credentials` grant gives an installed application an app-user token.
// Uninstalling revokes every token of the application and deactivates the app user.

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const VIEWER = '{ viewer { id name email app active admin guest } }';
const TEAM = 'query($id: String!) { team(id: $id) { id key } }';
const ISSUE_CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id } }
}`;
const ISSUE_UPDATE = `mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;
const COMMENT_CREATE = `mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) { success comment { id } }
}`;
const COMMENT_AUTHOR = 'query($id: String!) { comment(id: $id) { user { id app active } } }';
const ORG_UPDATE = `mutation($input: OrganizationUpdateInput!) {
  organizationUpdate(input: $input) { success }
}`;
const TEAM_PEOPLE = `query($id: String!) {
  team(id: $id) {
    memberships { nodes { user { id } } }
    members { nodes { id app isAssignable isMentionable } }
  }
}`;
const USERS = '{ users { nodes { id app } } }';
const CHANGE_ROLE = `mutation($id: String!, $role: UserRoleType!) {
  userChangeRole(id: $id, role: $role) { success }
}`;
const SUSPEND = 'mutation($id: String!) { userSuspend(id: $id) { success } }';

const code = (res: Awaited<ReturnType<typeof gql>>) => res.body.errors?.[0]?.extensions?.code;

async function teamId(owner: TestUser, key: string): Promise<string> {
  const res = await gql({ cookie: owner.cookie }, TEAM, { id: key });
  return (res.body.data?.team as { id: string }).id;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  await api.teams.post({ key: 'ENG', name: 'Engineering' });
  await api.teams.post({ key: 'SEC', name: 'Security' });
  await api.teams({ teamKey: 'SEC' }).patch({ visibility: 'private' });
  const client = await createClient(owner.cookie, {
    client_name: 'Robot',
    grant_types: ['authorization_code', 'client_credentials'],
  });
  return { owner, client };
}

interface InstallOptions {
  scope?: string;
  teamIds?: string[];
  publicTeams?: boolean;
}

// Authorize with actor=app and post the consent the way the web's consent page does,
// with the admin's team selection. Returns the consent response.
async function consentAsApp(
  cookie: string,
  client: OAuthClient,
  challenge: string,
  opts: InstallOptions = {},
): Promise<Response> {
  const authorize = await authorizeRequest(cookie, {
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: opts.scope ?? 'read,write',
    actor: 'app',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const target = new URL(await redirectTarget(authorize));
  return authPost('/oauth2/consent', cookie, {
    accept: true,
    oauth_query: target.search.slice(1),
    ...(opts.teamIds ? { app_team_ids: opts.teamIds } : {}),
    ...(opts.publicTeams !== undefined ? { app_public_teams: opts.publicTeams } : {}),
  });
}

// The full install: consent as an admin, then the code exchanged for tokens.
async function install(
  cookie: string,
  client: OAuthClient,
  opts: InstallOptions = {},
): Promise<TokenSet> {
  const { verifier, challenge } = pkce();
  const consent = await consentAsApp(cookie, client, challenge, opts);
  if (consent.status !== 200) throw new Error(`consent ${consent.status}: ${await consent.text()}`);
  const codeValue = new URL(await redirectTarget(consent)).searchParams.get('code');
  if (!codeValue) throw new Error('no code');
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    code: codeValue,
    redirect_uri: REDIRECT_URI,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code_verifier: verifier,
  });
  if (res.status !== 200) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenSet;
}

async function viewer(token: string) {
  const res = await gql(bearer(token), VIEWER);
  return res.body.data?.viewer as {
    id: string;
    email: string;
    app: boolean;
    active: boolean;
    admin: boolean;
    guest: boolean;
  };
}

function clientCredentials(client: OAuthClient, scope?: string): Promise<Response> {
  return tokenRequest({
    grant_type: 'client_credentials',
    client_id: client.clientId,
    client_secret: client.clientSecret,
    ...(scope ? { scope } : {}),
  });
}

function uninstall(cookie: string, client: OAuthClient): Promise<Response> {
  return authPost('/instance/oauth-uninstall', cookie, { clientId: client.clientId });
}

describe('oauth actor=app installs', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('refuses an install by someone who is not a workspace admin or owner', async () => {
    const { client } = await setup();
    const member = await signUpWithRole('member', { name: 'Member' });
    const { challenge } = pkce();
    const consent = await consentAsApp(member.cookie, client, challenge);
    expect(consent.status).toBe(403);
    expect(await clientCredentials(client).then((r) => r.status)).not.toBe(200);
  });

  it('creates one app user per application, which the install tokens act as', async () => {
    const { owner, client } = await setup();
    const first = await install(owner.cookie, client);
    const me = await viewer(first.access_token);
    expect(me.id).not.toBe(owner.userId);
    expect(me.app).toBe(true);
    expect(me.admin).toBe(false);
    expect(me.active).toBe(true);
    // The token response lists Linear's scopes only.
    expect(first.scope.split(' ').sort()).toEqual(['read', 'write']);

    const second = await install(owner.cookie, client);
    expect((await viewer(second.access_token)).id).toBe(me.id);

    // A user token of the same application still acts as the user.
    const userTokens = await obtainTokens(owner.cookie, client, 'read');
    expect((await viewer(userTokens.access_token)).id).toBe(owner.userId);
  });

  it('reaches only the teams chosen at install and never has admin rights', async () => {
    const { owner, client } = await setup();
    const mkt = await teamId(owner, 'MKT');
    const sec = await teamId(owner, 'SEC');

    const only = await install(owner.cookie, client, {
      scope: 'read,write,admin',
      teamIds: [mkt],
      publicTeams: false,
    });
    const token = only.access_token;
    expect((await gql(bearer(token), TEAM, { id: 'MKT' })).body.data?.team).toBeTruthy();
    expect(code(await gql(bearer(token), TEAM, { id: 'ENG' }))).toBe('ENTITY_NOT_FOUND');
    expect(code(await gql(bearer(token), TEAM, { id: 'SEC' }))).toBe('ENTITY_NOT_FOUND');
    expect(code(await gql(bearer(token), ORG_UPDATE, { input: { name: 'Hijacked' } }))).toBe(
      'FORBIDDEN',
    );

    // Reinstalling with every public team and the private team changes what it reaches.
    const wide = await install(owner.cookie, client, { teamIds: [sec] });
    const wideToken = wide.access_token;
    expect((await gql(bearer(wideToken), TEAM, { id: 'ENG' })).body.data?.team).toBeTruthy();
    expect((await gql(bearer(wideToken), TEAM, { id: 'SEC' })).body.data?.team).toBeTruthy();
    expect(code(await gql(bearer(token), TEAM, { id: 'MKT' }))).toBeUndefined();
  });

  it('keeps the app user out of member lists and offers it only with app scopes', async () => {
    const { owner, client } = await setup();
    const mkt = await teamId(owner, 'MKT');
    const plain = await install(owner.cookie, client, { teamIds: [mkt] });
    const appUserId = (await viewer(plain.access_token)).id;

    const people = async () => {
      const res = await gql({ cookie: owner.cookie }, TEAM_PEOPLE, { id: 'MKT' });
      return res.body.data?.team as {
        memberships: { nodes: { user: { id: string } }[] };
        members: {
          nodes: { id: string; app: boolean; isAssignable: boolean; isMentionable: boolean }[];
        };
      };
    };
    let team = await people();
    expect(team.memberships.nodes.map((n) => n.user.id)).not.toContain(appUserId);
    expect(team.members.nodes.map((n) => n.id)).not.toContain(appUserId);

    // Its role and suspension follow the install, not the workspace administration.
    const changed = await gql({ cookie: owner.cookie }, CHANGE_ROLE, {
      id: appUserId,
      role: 'admin',
    });
    expect(code(changed)).toBe('ENTITY_NOT_FOUND');
    const suspended = await gql({ cookie: owner.cookie }, SUSPEND, { id: appUserId });
    expect(code(suspended)).toBe('ENTITY_NOT_FOUND');

    const users = await gql({ cookie: owner.cookie }, USERS);
    const listed = (users.body.data?.users as { nodes: { id: string; app: boolean }[] }).nodes;
    expect(listed.find((u) => u.id === appUserId)?.app).toBe(true);

    await install(owner.cookie, client, {
      scope: 'read,write,app:assignable',
      teamIds: [mkt],
    });
    team = await people();
    expect(team.memberships.nodes.map((n) => n.user.id)).not.toContain(appUserId);
    const asMember = team.members.nodes.find((n) => n.id === appUserId);
    expect(asMember).toMatchObject({ app: true, isAssignable: true, isMentionable: false });

    // An app user is never the assignee (Linear makes it the delegate).
    const created = await gql({ cookie: owner.cookie }, ISSUE_CREATE, {
      input: { teamId: 'MKT', title: 'Task' },
    });
    const issueId = (created.body.data?.issueCreate as { issue: { id: string } }).issue.id;
    const assigned = await gql({ cookie: owner.cookie }, ISSUE_UPDATE, {
      id: issueId,
      input: { assigneeId: appUserId },
    });
    expect(code(assigned)).toBe('INVALID_INPUT');
  });

  it('cannot sign in as the app user', async () => {
    const { owner, client } = await setup();
    const tokens = await install(owner.cookie, client);
    const { email } = await viewer(tokens.access_token);
    // No magic link is issued for an app user's address (and the session hook
    // refuses any session for it, whatever the sign-in method).
    expect(await requestMagicLink(email)).toBeNull();
    const context = await auth.$context;
    const appUserId = (await viewer(tokens.access_token)).id;
    await expect(context.internalAdapter.createSession(appUserId)).rejects.toThrow(
      'An application cannot sign in',
    );
  });

  it('gives an installed application an app-user token through client_credentials', async () => {
    const { owner, client } = await setup();
    const before = await clientCredentials(client);
    expect(before.status).toBe(400);

    const installed = await install(owner.cookie, client, { scope: 'read,write' });
    const appUserId = (await viewer(installed.access_token)).id;

    const res = await clientCredentials(client);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenSet;
    expect(body.refresh_token).toBeUndefined();
    expect((await viewer(body.access_token)).id).toBe(appUserId);

    const narrower = await clientCredentials(client, 'read');
    expect(narrower.status).toBe(200);
    const beyond = await clientCredentials(client, 'read,admin');
    expect(beyond.status).toBe(400);
  });

  it('uninstalling revokes every token and deactivates the app user', async () => {
    const { owner, client } = await setup();
    const installed = await install(owner.cookie, client, { scope: 'read,write' });
    const m2m = (await (await clientCredentials(client)).json()) as TokenSet;
    const userTokens = await obtainTokens(owner.cookie, client, 'read');

    const issue = await gql(bearer(installed.access_token), ISSUE_CREATE, {
      input: { teamId: 'MKT', title: 'From the app' },
    });
    const issueId = (issue.body.data?.issueCreate as { issue: { id: string } }).issue.id;
    const comment = await gql(bearer(installed.access_token), COMMENT_CREATE, {
      input: { issueId, body: 'Hello from the app' },
    });
    const commentId = (comment.body.data?.commentCreate as { comment: { id: string } }).comment.id;
    const appUserId = (await viewer(installed.access_token)).id;

    // A member may not uninstall.
    const member = await signUpWithRole('member', { name: 'Member' });
    expect((await uninstall(member.cookie, client)).status).toBe(403);

    expect((await uninstall(owner.cookie, client)).status).toBe(200);
    for (const token of [installed.access_token, m2m.access_token, userTokens.access_token])
      expect((await gql(bearer(token), VIEWER)).status).not.toBe(200);
    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: installed.refresh_token!,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(refreshed.status).toBe(400);
    expect((await clientCredentials(client)).status).toBe(400);

    const author = await gql({ cookie: owner.cookie }, COMMENT_AUTHOR, { id: commentId });
    expect((author.body.data?.comment as { user: unknown }).user).toEqual({
      id: appUserId,
      app: true,
      active: false,
    });
  });

  it('refuses actor=app for a self-registered (MCP) client', async () => {
    const reg = await app.handle(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [REDIRECT_URI],
          client_name: 'MCP client',
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    expect(reg.status).toBeLessThan(300);
    const { client_id } = (await reg.json()) as { client_id: string };
    const owner = await signUpTestUser({ name: 'Owner' });
    const { challenge } = pkce();
    const consent = await consentAsApp(
      owner.cookie,
      { clientId: client_id, clientSecret: '' },
      challenge,
    ).catch(() => null);
    expect(consent === null || consent.status !== 200).toBe(true);
  });

  it('gives a confidential application that skips PKCE a refresh token', async () => {
    const { owner, client } = await setup();
    const authorize = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
    });
    let target = new URL(await redirectTarget(authorize));
    if (!target.searchParams.get('code')) {
      const consent = await authPost('/oauth2/consent', owner.cookie, {
        accept: true,
        oauth_query: target.search.slice(1),
      });
      target = new URL(await redirectTarget(consent));
    }
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      code: target.searchParams.get('code')!,
      redirect_uri: REDIRECT_URI,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as TokenSet;
    expect(tokens.refresh_token?.startsWith('itpr_')).toBe(true);
    expect(tokens.scope).toBe('read');

    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as TokenSet;
    expect(next.refresh_token).toBeTruthy();
    expect((await viewer(next.access_token)).id).toBe(owner.userId);
    expect((await gql(bearer(tokens.access_token), VIEWER)).body.data?.viewer).toBeFalsy();
  });
});
