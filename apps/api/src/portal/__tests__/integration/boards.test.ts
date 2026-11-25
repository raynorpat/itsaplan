import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  archiveIssue,
  createIssue,
  createLabel,
  createProject,
  createTeam,
  signUpAs,
  statesByType,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { boardIssueIds, boardShowsIssue, boardsShowingIssue, getBoardBySlug } from '../../boards';
import { publicStatus } from '../../status';

// Portal boards: owners and admins manage them through /api/auth/instance/portal/*;
// a board shows the active issues of one public team or one project (public teams
// only), narrowed by labels, with canceled and long-completed issues left out.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function call(path: string, init: { as: TestUser; body?: unknown; query?: Json }) {
  const headers = new Headers({ origin: ORIGIN, cookie: init.as.cookie });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : '';
  return app.handle(
    new Request(`http://localhost/api/auth/instance/portal/${path}${qs}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const createBoard = async (as: TestUser, body: Json) =>
  (await ok(await call('boards/create', { as, body }))).board as Json;

const DAY = 86_400_000;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const admin = await signUpAs('admin', { name: 'Admin' });
  const member = await signUpAs('member', { name: 'Member' });
  const guest = await signUpAs('guest', { name: 'Guest' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const states = statesByType(eng);
  return { owner, admin, member, guest, eng, states };
}

describe('publicStatus', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  it('maps state types to the three public statuses', () => {
    // Triage holds issues the team has not accepted yet; boards never show them.
    expect(publicStatus('triage', null, now)).toBeNull();
    expect(publicStatus('backlog', null, now)).toBe('planned');
    expect(publicStatus('unstarted', null, now)).toBe('planned');
    expect(publicStatus('started', null, now)).toBe('inProgress');
    expect(publicStatus('canceled', null, now)).toBeNull();
  });
  it('shows completed issues for 30 days', () => {
    expect(publicStatus('completed', new Date(now.getTime() - 29 * DAY), now)).toBe('done');
    expect(publicStatus('completed', new Date(now.getTime() - 31 * DAY), now)).toBeNull();
    expect(publicStatus('completed', null, now)).toBeNull();
  });
});

describe('portal boards', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets an admin create, update and delete a board', async () => {
    const { admin, eng } = await setup();
    const board = await createBoard(admin, {
      slug: 'roadmap',
      name: 'Roadmap',
      teamId: eng.team.id,
      access: 'restricted',
      allowedDomains: ['Example.com'],
      allowedEmails: ['Jane@Other.org'],
    });
    expect(board.slug).toBe('roadmap');
    expect(board.allowedDomains).toEqual(['example.com']);
    expect(board.allowedEmails).toEqual(['jane@other.org']);
    expect(board.comments).toBe('portal');
    expect(board.showDescription).toBe(false);

    const updated = (
      await ok(
        await call('boards/update', {
          as: admin,
          body: { id: board.id, name: 'Public roadmap', access: 'public', comments: 'all' },
        }),
      )
    ).board;
    expect(updated.name).toBe('Public roadmap');
    expect(updated.comments).toBe('all');
    expect((await ok(await call('boards', { as: admin }))).boards.length).toBe(1);

    await ok(await call('boards/delete', { as: admin, body: { id: board.id } }));
    expect((await ok(await call('boards', { as: admin }))).boards).toEqual([]);
  });

  it('refuses members and guests', async () => {
    const { member, guest, eng } = await setup();
    for (const as of [member, guest]) {
      expect((await call('boards', { as })).status).toBe(403);
      const res = await call('boards/create', {
        as,
        body: { slug: 'x', name: 'X', teamId: eng.team.id },
      });
      expect(res.status).toBe(403);
    }
  });

  it('validates the slug, the scope and the team', async () => {
    const { owner, admin, eng } = await setup();
    const bad = async (body: Json) =>
      (await call('boards/create', { as: admin, body: { name: 'B', ...body } })).status;
    expect(await bad({ slug: 'Has Space', teamId: eng.team.id })).toBe(400);
    // /portal/unsubscribe is the web app's unsubscribe page, not a board.
    expect(await bad({ slug: 'unsubscribe', teamId: eng.team.id })).toBe(400);
    expect(await bad({ slug: 'ok' })).toBe(400);
    const project = await createProject(owner, { name: 'P', teamIds: ['ENG'] });
    expect(await bad({ slug: 'ok', teamId: eng.team.id, projectId: project.id })).toBe(400);
    const priv = await createTeam(owner, { key: 'SEC', private: true });
    expect(await bad({ slug: 'ok', teamId: priv.team.id })).toBe(400);
    await createBoard(admin, { slug: 'taken', name: 'T', teamId: eng.team.id });
    // A handler's status beyond the common ones reaches the client with its message.
    const taken = await call('boards/create', {
      as: admin,
      body: { name: 'B', slug: 'taken', teamId: eng.team.id },
    });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { message: string }).message).toBe(
      'This board address is taken',
    );
  });

  it('gives suggestions a Portal label on the suggestion team by default', async () => {
    const { owner, admin, eng, states } = await setup();
    const board = await createBoard(admin, {
      slug: 'ideas',
      name: 'Ideas',
      teamId: eng.team.id,
      suggestionsEnabled: true,
      suggestionTeamId: eng.team.id,
      suggestionStateId: states.backlog,
    });
    const labels = (await teamView(owner, 'ENG')).labels;
    const portal = labels.find((l) => l.name === 'Portal');
    expect(portal).toBeDefined();
    expect(board.suggestionLabelId).toBe(portal!.id);

    const other = await createTeam(owner, { key: 'OPS' });
    const res = await call('boards/update', {
      as: admin,
      body: { id: board.id, suggestionStateId: statesByType(other).backlog },
    });
    expect(res.status).toBe(400);
  });

  it('shows the active public issues of a team, narrowed by labels', async () => {
    const { owner, admin, eng, states } = await setup();
    const now = new Date();
    const open = await createIssue(owner, { teamId: 'ENG', stateId: states.unstarted });
    const started = await createIssue(owner, { teamId: 'ENG', stateId: states.started });
    const canceled = await createIssue(owner, { teamId: 'ENG', stateId: states.canceled });
    const old = await createIssue(owner, {
      teamId: 'ENG',
      stateId: states.completed,
      createdAt: new Date(now.getTime() - 60 * DAY).toISOString(),
      completedAt: new Date(now.getTime() - 40 * DAY).toISOString(),
    });
    const recent = await createIssue(owner, { teamId: 'ENG', stateId: states.completed });
    const archived = await createIssue(owner, { teamId: 'ENG', stateId: states.unstarted });
    await archiveIssue(owner, archived.id);

    const created = await createBoard(admin, { slug: 'eng', name: 'Eng', teamId: eng.team.id });
    const board = (await getBoardBySlug(created.slug))!;
    const ids = await boardIssueIds(board, now);
    expect(new Set(ids)).toEqual(new Set([open.id, started.id, recent.id]));
    expect(ids).not.toContain(canceled.id);
    expect(ids).not.toContain(old.id);
    expect(await boardShowsIssue(board, archived.id, now)).toBe(false);

    const label = await createLabel(owner, { name: 'Public', teamId: 'ENG' });
    const labeled = await createIssue(owner, {
      teamId: 'ENG',
      stateId: states.unstarted,
      labelIds: [label.id],
    });
    await ok(
      await call('boards/update', { as: admin, body: { id: created.id, labelIds: [label.id] } }),
    );
    const narrowed = (await getBoardBySlug('eng'))!;
    expect(await boardIssueIds(narrowed, now)).toEqual([labeled.id]);
  });

  it("leaves a project's private-team issues out", async () => {
    const { owner, admin, member } = await setup();
    const priv = await createTeam(owner, { key: 'SEC', private: true });
    const project = await createProject(owner, { name: 'Launch', teamIds: ['ENG', 'SEC'] });
    const pub = await createIssue(owner, {
      teamId: 'ENG',
      stateId: statesByType(await teamView(owner, 'ENG')).unstarted,
      projectId: project.id,
    });
    const hidden = await createIssue(owner, {
      teamId: 'SEC',
      stateId: statesByType(priv).unstarted,
      projectId: project.id,
    });
    await createBoard(admin, { slug: 'launch', name: 'Launch', projectId: project.id });
    const board = (await getBoardBySlug('launch'))!;
    expect(await boardIssueIds(board, new Date())).toEqual([pub.id]);
    expect(await boardShowsIssue(board, hidden.id, new Date())).toBe(false);

    const boards = await ok(await call('issue-boards', { as: member, query: { issueId: pub.id } }));
    expect(boards.boards.map((b: Json) => b.slug)).toEqual(['launch']);
    expect((await boardsShowingIssue(hidden.id)).length).toBe(0);
  });

  it('answers null for a disabled board', async () => {
    const { admin, eng } = await setup();
    const board = await createBoard(admin, { slug: 'off', name: 'Off', teamId: eng.team.id });
    await ok(await call('boards/update', { as: admin, body: { id: board.id, enabled: false } }));
    expect(await getBoardBySlug('off')).toBeNull();
  });

  it('refuses guests the boards of an issue', async () => {
    const { owner, guest, states } = await setup();
    await addMember(owner, 'ENG', guest.userId);
    const issue = await createIssue(owner, { teamId: 'ENG', stateId: states.unstarted });
    const res = await call('issue-boards', { as: guest, query: { issueId: issue.id } });
    expect(res.status).toBe(403);
  });
});
