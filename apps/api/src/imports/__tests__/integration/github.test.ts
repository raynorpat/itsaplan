import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { ORIGIN } from '../../../__tests__/helpers/oauth';

// GitHub issue imports through Linear's import model (integrationGithubImportConnect,
// issueImportCreateGithub, issueImportProcess) against a stub GitHub (API and web).

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const APP_ID = '777';
const USER_TOKEN = 'gho_user_token';
const INSTALLATION_TOKEN = 'ghs_installation_token';

// Checks the app JWT the API signs: RS256 with the app's key, issued by the app id.
function validAppJwt(header: string | null): boolean {
  const jwt = header?.replace(/^Bearer /, '') ?? '';
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return false;
  const ok = verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })),
    Buffer.from(s, 'base64url'),
  );
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Json;
  return ok && payload.iss === APP_ID;
}

const ghUser = (id: number, login: string) => ({ id, login });

function ghIssue(n: number, extra: Json = {}): Json {
  return {
    number: n,
    title: `GitHub ${n}`,
    body: `Body ${n}`,
    state: 'open',
    state_reason: null,
    html_url: `https://github.com/acme/app/issues/${n}`,
    labels: n === 1 ? [{ name: 'bug', color: 'd73a4a' }] : [],
    user: ghUser(1, 'octocat'),
    assignee: n === 1 ? ghUser(2, 'hubot') : null,
    created_at: `2024-01-0${n}T10:00:00Z`,
    closed_at: null,
    comments: n === 1 ? 1 : 0,
    ...extra,
  };
}

const ghIssues: Json[] = [
  ghIssue(1),
  ghIssue(2, { state: 'closed', state_reason: 'completed', closed_at: '2024-02-01T10:00:00Z' }),
  ghIssue(3, { state: 'closed', state_reason: 'not_planned', closed_at: '2024-02-02T10:00:00Z' }),
  ghIssue(4, { pull_request: { url: 'x' } }),
];

const github = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get('authorization');
    if (url.pathname === '/login/oauth/access_token' && req.method === 'POST') {
      const body = (await req.json()) as Json;
      if (body.client_id !== 'client-id' || body.client_secret !== 'client-secret')
        return Response.json({ error: 'incorrect_client_credentials' });
      return body.code === 'good-code'
        ? Response.json({ access_token: USER_TOKEN, token_type: 'bearer' })
        : Response.json({ error: 'bad_verification_code' });
    }
    if (url.pathname === '/user/installations') {
      if (auth !== `Bearer ${USER_TOKEN}`) return new Response('no', { status: 401 });
      return Response.json({ total_count: 1, installations: [{ id: 42 }] });
    }
    if (url.pathname === '/app/installations/42/access_tokens' && req.method === 'POST') {
      if (!validAppJwt(auth)) return new Response('bad jwt', { status: 401 });
      return Response.json({
        token: INSTALLATION_TOKEN,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }
    if (auth !== `Bearer ${INSTALLATION_TOKEN}`) return new Response('no', { status: 401 });
    if (url.pathname === '/installation/repositories')
      return Response.json({
        total_count: 1,
        repositories:
          Number(url.searchParams.get('page')) === 1 ? [{ id: 101, full_name: 'acme/app' }] : [],
      });
    if (url.pathname === '/repos/acme/app/issues') {
      const state = url.searchParams.get('state');
      const items = ghIssues.filter((i) => state === 'all' || i.state === 'open');
      const page = Number(url.searchParams.get('page'));
      const perPage = Number(url.searchParams.get('per_page'));
      return Response.json(items.slice((page - 1) * perPage, page * perPage));
    }
    if (url.pathname === '/repos/acme/app/issues/1/comments')
      return Response.json(
        Number(url.searchParams.get('page')) === 1
          ? [{ user: ghUser(2, 'hubot'), body: 'A comment', created_at: '2024-01-02T10:00:00Z' }]
          : [],
      );
    if (url.pathname === '/users/octocat')
      return Response.json({
        id: 1,
        login: 'octocat',
        name: 'Octo Cat',
        email: 'octo@example.com',
      });
    if (url.pathname === '/users/hubot')
      return Response.json({ id: 2, login: 'hubot', name: null, email: null });
    return new Response('not found', { status: 404 });
  },
});

const ENV = {
  GITHUB_IMPORT_APP_ID: APP_ID,
  GITHUB_IMPORT_APP_SLUG: 'itsaplan-import',
  GITHUB_IMPORT_CLIENT_ID: 'client-id',
  GITHUB_IMPORT_CLIENT_SECRET: 'client-secret',
  // As it is pasted into an env file: one line with escaped newlines.
  GITHUB_IMPORT_PRIVATE_KEY: PRIVATE_KEY.replace(/\n/g, '\\n'),
  GITHUB_IMPORT_API_URL: `http://localhost:${github.port}`,
  GITHUB_IMPORT_WEB_URL: `http://localhost:${github.port}`,
};

function setEnv(on: boolean) {
  for (const [k, v] of Object.entries(ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

afterAll(() => {
  setEnv(false);
  github.stop(true);
});

let owner: TestUser;
let teamId: string;

const headers = (who: TestUser) => ({ cookie: who.cookie });

async function query(who: TestUser, q: string, variables?: Json) {
  return (await gql(headers(who), q, variables)).body as { data?: Json; errors?: Json[] };
}

async function instance(path: string, who: TestUser, body?: unknown): Promise<Response> {
  const h = new Headers({ cookie: who.cookie, origin: ORIGIN });
  if (body !== undefined) h.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

async function waitFor(id: string, done: (imp: Json) => boolean): Promise<Json> {
  for (let i = 0; i < 200; i += 1) {
    const imp = (await ok(await instance(`import?id=${id}`, owner))).import as Json;
    if (done(imp)) return imp;
    await Bun.sleep(25);
  }
  throw new Error('The import did not reach the expected state');
}

const CONNECT = `mutation($code: String!, $installationId: String!) {
  integrationGithubImportConnect(code: $code, installationId: $installationId) {
    success integration { id service creator { id } }
  }
}`;

const CREATE = `mutation($repos: [Int!], $teamId: String, $closed: Boolean, $instant: Boolean) {
  issueImportCreateGithub(githubRepoIds: $repos, teamId: $teamId, includeClosedIssues: $closed, instantProcess: $instant) {
    success issueImport { id service status displayName }
  }
}`;

const PROCESS = `mutation($id: String!, $mapping: JSONObject!) {
  issueImportProcess(issueImportId: $id, mapping: $mapping) { success issueImport { id status } }
}`;

async function connect(): Promise<string> {
  const res = await query(owner, CONNECT, { code: 'good-code', installationId: '42' });
  expect(res.errors).toBeUndefined();
  return res.data!.integrationGithubImportConnect.integration.id as string;
}

beforeEach(async () => {
  setEnv(true);
  await resetDb();
  owner = await signUpTestUser({ name: 'Owner' });
  teamId = (await createTeam(owner, { key: 'ENG', name: 'Engineering' })).team.id;
});

describe('GitHub import', () => {
  it('says GitHub imports are not set up without the app settings', async () => {
    setEnv(false);
    const res = await query(owner, CREATE, { repos: [101], teamId });
    expect(res.errors?.[0]?.message).toBe('GitHub imports are not set up on this instance');
    const status = await ok(await instance('imports/github', owner));
    expect(status).toMatchObject({ configured: false, integration: null });
  });

  it('connects the installation the authorizing user can access', async () => {
    const res = await query(owner, CONNECT, { code: 'good-code', installationId: '42' });
    expect(res.errors).toBeUndefined();
    expect(res.data!.integrationGithubImportConnect).toMatchObject({
      success: true,
      integration: { service: 'githubImport', creator: { id: owner.userId } },
    });
    const status = await ok(await instance('imports/github', owner));
    expect(status).toMatchObject({
      configured: true,
      appSlug: 'itsaplan-import',
      integration: { installationId: '42' },
    });
    expect(JSON.stringify(status)).not.toContain(USER_TOKEN);
  });

  it('refuses a bad code and an installation the user cannot access', async () => {
    const bad = await query(owner, CONNECT, { code: 'bad-code', installationId: '42' });
    expect(bad.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    const other = await query(owner, CONNECT, { code: 'good-code', installationId: '99' });
    expect(other.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('refuses members', async () => {
    const member = await signUpAs('member');
    for (const q of [CONNECT, CREATE]) {
      const res = await query(member, q, {
        code: 'good-code',
        installationId: '42',
        repos: [101],
        teamId,
      });
      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    }
    expect((await instance('imports/github/repositories', member)).status).toBe(403);
  });

  it('refreshes and lists the installation repositories', async () => {
    const id = await connect();
    const res = await query(
      owner,
      `mutation($id: String!) { integrationGithubImportRefresh(id: $id) { success } }`,
      { id },
    );
    expect(res.data?.integrationGithubImportRefresh.success).toBe(true);
    const repos = await ok(await instance('imports/github/repositories', owner));
    expect(repos.repositories).toEqual([{ id: 101, name: 'acme/app' }]);
  });

  it('fetches, matches people and processes', async () => {
    await connect();
    const created = await query(owner, CREATE, { repos: [101], teamId, closed: true });
    expect(created.errors).toBeUndefined();
    const imp = created.data!.issueImportCreateGithub.issueImport as Json;
    expect(imp).toMatchObject({ service: 'github', status: 'inProgress', displayName: 'acme/app' });

    await waitFor(imp.id, (i) => i.awaitingPeople === true);
    const people = (await ok(await instance(`import/people?id=${imp.id}`, owner))).people as Json[];
    expect(people.map((p) => [p.login, p.name, p.email])).toEqual([
      ['octocat', 'Octo Cat', 'octo@example.com'],
      ['hubot', null, null],
    ]);

    const processed = await query(owner, PROCESS, {
      id: imp.id,
      mapping: { people: { '1': owner.userId, '2': null } },
    });
    expect(processed.errors).toBeUndefined();
    const done = await waitFor(imp.id, (i) => i.status === 'complete' || i.status === 'error');
    expect(done.status).toBe('complete');
    expect(done.summary).toMatchObject({ issues: 3, comments: 1, total: 3 });

    const issues = await query(
      owner,
      `query($id: String!) { team(id: $id) { issues { nodes { title state { type } } } } }`,
      { id: teamId },
    );
    const nodes = issues.data!.team.issues.nodes as Json[];
    const byTitle = Object.fromEntries(nodes.map((n) => [n.title, n.state.type]));
    expect(byTitle).toEqual({
      'GitHub 1': 'unstarted',
      'GitHub 2': 'completed',
      'GitHub 3': 'canceled',
    });
  });

  it('processes at once with instantProcess', async () => {
    await connect();
    const created = await query(owner, CREATE, { repos: [101], teamId, instant: true });
    const id = created.data!.issueImportCreateGithub.issueImport.id as string;
    const done = await waitFor(id, (i) => i.status === 'complete' || i.status === 'error');
    expect(done.status).toBe('complete');
    expect(done.summary).toMatchObject({ issues: 1, total: 1 });
  });

  it('refuses a repository the installation cannot see', async () => {
    await connect();
    const res = await query(owner, CREATE, { repos: [555], teamId });
    expect(res.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('needs a connected installation', async () => {
    const res = await query(owner, CREATE, { repos: [101], teamId });
    expect(res.errors?.[0]?.message).toBe('Connect GitHub before importing');
  });
});
