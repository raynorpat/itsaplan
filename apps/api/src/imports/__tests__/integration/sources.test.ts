import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, issue, issueImport } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { fetchGitea, listGiteaRepos } from '../../sources/gitea';
import { fetchGitlab, listGitlabProjects } from '../../sources/gitlab';

// GitLab, Gitea and Forgejo sources against stub servers, and the instance endpoints
// that drive an import (/api/auth/instance/imports*).

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TOKEN = 'secret-token-123';

// --- Stub Gitea / Forgejo -------------------------------------------------------------

const giteaUser = (id: number, login: string) => ({
  id,
  login,
  full_name: login === 'ann' ? 'Ann Gitea' : '',
  email: login === 'ann' ? 'ann@example.com' : `${login}@noreply.localhost`,
});

function giteaIssue(n: number, extra: Json = {}): Json {
  return {
    number: n,
    title: `Gitea ${n}`,
    body: `Body ${n}`,
    state: 'open',
    html_url: `http://gitea.test/acme/app/issues/${n}`,
    labels: n === 1 ? [{ name: 'bug', color: 'd73a4a' }] : [],
    user: giteaUser(1, 'ann'),
    assignee: n === 1 ? giteaUser(2, 'bob') : null,
    assignees: null,
    created_at: `2024-01-0${n}T10:00:00Z`,
    closed_at: null,
    comments: n === 1 ? 2 : 0,
    pull_request: null,
    ...extra,
  };
}

const giteaIssues: Json[] = [
  giteaIssue(1),
  giteaIssue(2, { state: 'closed', closed_at: '2024-02-01T10:00:00Z' }),
  giteaIssue(3, { pull_request: { merged: false } }),
  giteaIssue(4),
  giteaIssue(5),
];

let giteaRateLimited = false;
let giteaRequests: string[] = [];

const gitea = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    giteaRequests.push(url.pathname + url.search);
    if (req.headers.get('authorization') !== `token ${TOKEN}`)
      return new Response(`bad token ${req.headers.get('authorization')}`, { status: 401 });
    if (url.pathname === '/redirect/api/v1/user/repos')
      return new Response(null, { status: 302, headers: { location: 'http://elsewhere.test/' } });
    if (url.pathname === '/broken/api/v1/user/repos')
      return new Response(`internal error, token was ${TOKEN}`, { status: 500 });
    if (url.pathname === '/api/v1/user/repos') {
      const page = Number(url.searchParams.get('page'));
      return Response.json(page === 1 ? [{ full_name: 'acme/app', private: false }] : []);
    }
    if (url.pathname === '/api/v1/repos/acme/app/issues') {
      if (giteaRateLimited) {
        giteaRateLimited = false;
        return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
      }
      const limit = Number(url.searchParams.get('limit'));
      const page = Number(url.searchParams.get('page'));
      const state = url.searchParams.get('state');
      const all = giteaIssues.filter((i) => state === 'all' || i.state === 'open');
      return Response.json(all.slice((page - 1) * limit, page * limit));
    }
    if (url.pathname === '/api/v1/repos/acme/app/issues/1/comments') {
      const page = Number(url.searchParams.get('page'));
      return Response.json(
        page === 1
          ? [
              { user: giteaUser(2, 'bob'), body: 'First', created_at: '2024-01-02T10:00:00Z' },
              { user: giteaUser(1, 'ann'), body: 'Second', created_at: '2024-01-03T10:00:00Z' },
            ]
          : [],
      );
    }
    return new Response('not found', { status: 404 });
  },
});

// --- Stub GitLab ---------------------------------------------------------------------

const glUser = (id: number, username: string) => ({ id, username, name: `${username} GL` });

function glIssue(iid: number, extra: Json = {}): Json {
  return {
    iid,
    title: `GitLab ${iid}`,
    description: `Desc **${iid}**`,
    state: 'opened',
    web_url: `http://gitlab.test/acme/app/-/issues/${iid}`,
    labels: iid === 1 ? [{ name: 'Backend', color: '#ff0000' }] : [],
    author: glUser(10, 'carol'),
    assignee: iid === 1 ? glUser(11, 'dave') : null,
    assignees: iid === 1 ? [glUser(11, 'dave')] : [],
    created_at: `2024-03-0${iid}T10:00:00Z`,
    closed_at: null,
    user_notes_count: iid === 1 ? 1 : 0,
    ...extra,
  };
}

const glIssues: Json[] = [
  glIssue(1),
  glIssue(2, { state: 'closed', closed_at: '2024-04-01T10:00:00Z' }),
  glIssue(3),
];

const gitlab = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('private-token') !== TOKEN)
      return new Response('unauthorized', { status: 401 });
    const page = Number(url.searchParams.get('page') || '1');
    const perPage = Number(url.searchParams.get('per_page'));
    const paged = (rows: Json[]) => {
      const slice = rows.slice((page - 1) * perPage, page * perPage);
      const next = page * perPage < rows.length ? String(page + 1) : '';
      return Response.json(slice, { headers: { 'x-next-page': next } });
    };
    if (url.pathname === '/api/v4/projects')
      return paged([
        { path_with_namespace: 'acme/app' },
        { path_with_namespace: 'acme/web' },
        { path_with_namespace: 'acme/ops' },
      ]);
    if (url.pathname === '/api/v4/projects/acme%2Fapp/issues') {
      const state = url.searchParams.get('state');
      return paged(glIssues.filter((i) => !state || i.state === state));
    }
    if (url.pathname === '/api/v4/projects/acme%2Fapp/issues/1/notes')
      return paged([
        {
          author: glUser(11, 'dave'),
          body: 'changed the label',
          system: true,
          created_at: '2024-03-02T09:00:00Z',
        },
        {
          author: glUser(11, 'dave'),
          body: 'A note',
          system: false,
          created_at: '2024-03-02T10:00:00Z',
        },
      ]);
    return new Response('not found', { status: 404 });
  },
});

const giteaHost = `http://localhost:${gitea.port}`;
const gitlabHost = `http://localhost:${gitlab.port}`;

afterAll(() => {
  gitea.stop(true);
  gitlab.stop(true);
});

// --- Source clients ------------------------------------------------------------------

describe('Gitea / Forgejo source', () => {
  beforeEach(() => {
    giteaRequests = [];
    giteaRateLimited = false;
  });

  it('lists repositories', async () => {
    expect(await listGiteaRepos(giteaHost, TOKEN)).toEqual([{ id: 'acme/app', name: 'acme/app' }]);
  });

  it('pages issues, skips pull requests and reads comments', async () => {
    const data = await fetchGitea(giteaHost, TOKEN, 'acme/app', {
      includeClosed: true,
      serviceLabel: 'Forgejo',
      pageSize: 2,
    });
    expect(data.serviceLabel).toBe('Forgejo');
    expect(data.issues.map((i) => i.number)).toEqual([1, 2, 4, 5]);
    // Three pages of issues (2 + 2 + 1) and an empty fourth.
    expect(
      giteaRequests.filter((r) => r.startsWith('/api/v1/repos/acme/app/issues?')),
    ).toHaveLength(3);
    const [one, two] = data.issues as [(typeof data.issues)[0], (typeof data.issues)[0]];
    expect(one).toMatchObject({
      url: 'http://gitea.test/acme/app/issues/1',
      title: 'Gitea 1',
      body: 'Body 1',
      state: 'open',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      author: { key: '1', login: 'ann', name: 'Ann Gitea', email: 'ann@example.com' },
      assignee: { key: '2', login: 'bob' },
      createdAt: '2024-01-01T10:00:00Z',
    });
    expect(one.comments.map((c) => [c.author.login, c.body])).toEqual([
      ['bob', 'First'],
      ['ann', 'Second'],
    ]);
    expect(two).toMatchObject({ state: 'closed', closedAt: '2024-02-01T10:00:00Z' });
  });

  it('leaves closed issues out unless asked', async () => {
    const data = await fetchGitea(giteaHost, TOKEN, 'acme/app', {
      includeClosed: false,
      serviceLabel: 'Gitea',
    });
    expect(data.issues.map((i) => i.number)).toEqual([1, 4, 5]);
  });

  it('waits and retries after a rate limit', async () => {
    giteaRateLimited = true;
    const data = await fetchGitea(giteaHost, TOKEN, 'acme/app', {
      includeClosed: false,
      serviceLabel: 'Gitea',
    });
    expect(data.issues).toHaveLength(3);
  });

  it('does not follow a redirect', async () => {
    await expect(listGiteaRepos(`${giteaHost}/redirect`, TOKEN)).rejects.toThrow(/redirect/i);
  });

  it('never puts the token in an error', async () => {
    const err = await listGiteaRepos(`${giteaHost}/broken`, TOKEN).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
    const refused = await listGiteaRepos(giteaHost, 'wrong').catch((e: Error) => e);
    expect((refused as Error).message).toMatch(/token/i);
  });
});

describe('GitLab source', () => {
  it('lists projects over pages', async () => {
    const projects = await listGitlabProjects(gitlabHost, TOKEN, { pageSize: 2 });
    expect(projects.map((p) => p.id)).toEqual(['acme/app', 'acme/web', 'acme/ops']);
  });

  it('pages issues, maps states and label colours, skips system notes', async () => {
    const data = await fetchGitlab(gitlabHost, TOKEN, 'acme/app', {
      includeClosed: true,
      pageSize: 2,
    });
    expect(data.serviceLabel).toBe('GitLab');
    expect(data.issues.map((i) => [i.number, i.state])).toEqual([
      [1, 'open'],
      [2, 'closed'],
      [3, 'open'],
    ]);
    const one = data.issues[0]!;
    expect(one).toMatchObject({
      url: 'http://gitlab.test/acme/app/-/issues/1',
      body: 'Desc **1**',
      labels: [{ name: 'Backend', color: '#ff0000' }],
      author: { key: '10', login: 'carol', name: 'carol GL', email: null },
      assignee: { key: '11', login: 'dave' },
    });
    expect(one.comments.map((c) => c.body)).toEqual(['A note']);
  });

  it('asks for open issues only unless closed ones are included', async () => {
    const data = await fetchGitlab(gitlabHost, TOKEN, 'acme/app', { includeClosed: false });
    expect(data.issues.map((i) => i.number)).toEqual([1, 3]);
  });
});

// --- Instance endpoints --------------------------------------------------------------

let owner: TestUser;
let teamId: string;

function call(path: string, as: TestUser, body?: unknown) {
  const headers = new Headers({ origin: ORIGIN, cookie: as.cookie });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
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
    const imp = (await ok(await call(`import?id=${id}`, owner))).import as Json;
    if (done(imp)) return imp;
    await Bun.sleep(25);
  }
  throw new Error('The import did not reach the expected state');
}

describe('instance import endpoints', () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Owner' });
    teamId = (await createTeam(owner, { key: 'ENG', name: 'Engineering' })).team.id;
  });

  it('refuses members and guests', async () => {
    const member = await signUpAs('member');
    const guest = await signUpAs('guest');
    for (const who of [member, guest]) {
      expect((await call('imports', who)).status).toBe(403);
      expect(
        (
          await call('imports/repositories', who, {
            service: 'gitea',
            host: giteaHost,
            token: TOKEN,
          })
        ).status,
      ).toBe(403);
    }
  });

  it('lists repositories for a host and token', async () => {
    const res = await ok(
      await call('imports/repositories', owner, {
        service: 'gitlab',
        host: gitlabHost,
        token: TOKEN,
      }),
    );
    expect(res.repositories.map((r: Json) => r.id)).toContain('acme/app');
  });

  it('fetches, matches people, processes, and keeps no token', async () => {
    const started = await ok(
      await call('imports/start', owner, {
        service: 'gitea',
        host: giteaHost,
        token: TOKEN,
        repository: 'acme/app',
        teamId,
        includeClosed: true,
      }),
    );
    const id = started.import.id as string;
    const fetched = await waitFor(id, (imp) => imp.status === 'inProgress' && imp.awaitingPeople);

    const people = (await ok(await call(`import/people?id=${id}`, owner))).people as Json[];
    expect(people.map((p) => [p.login, p.issues])).toEqual([
      ['ann', 4],
      ['bob', 1],
    ]);

    await ok(
      await call('imports/process', owner, { id, people: { '1': owner.userId, '2': null } }),
    );
    const done = await waitFor(id, (imp) => imp.status === 'complete' || imp.status === 'error');
    expect(done.status).toBe('complete');
    expect(done.summary).toMatchObject({ issues: 4, comments: 2, total: 4 });

    const issues = await db.select().from(issue).where(eq(issue.teamId, teamId));
    expect(issues).toHaveLength(4);

    const [row] = await db.select().from(issueImport).where(eq(issueImport.id, id));
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(fetched)).not.toContain(TOKEN);
    expect(JSON.stringify(await ok(await call('imports', owner)))).not.toContain(TOKEN);
  });

  it('ends a failing fetch as an error without the token', async () => {
    const started = await ok(
      await call('imports/start', owner, {
        service: 'gitea',
        host: `${giteaHost}/broken`,
        token: TOKEN,
        repository: 'acme/app',
        teamId,
        includeClosed: true,
      }),
    );
    const id = started.import.id as string;
    const failed = await waitFor(id, (imp) => imp.status === 'error');
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain(TOKEN);
    const [row] = await db.select().from(issueImport).where(eq(issueImport.id, id));
    expect(JSON.stringify(row)).not.toContain(TOKEN);
  });
});
