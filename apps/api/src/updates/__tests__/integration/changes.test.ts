import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createComment,
  createIssue,
  createProject,
  createTeam,
  gqlData,
  makePrivate,
  signUpAs,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import {
  createBoard,
  instance,
  ok,
  portal,
  visitor,
  type Json,
} from '../../../portal/__tests__/helpers';
import { requesterChanges, requestersWithChangesSince, type Change } from '../../changes';

// The "what changed since" lookup for a requester: status changes of the issues they
// follow, replies in portal threads they wrote in, and project updates the team shared,
// within the person's current access.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Mia' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await addMember(owner, 'ENG', member.userId);
  const states = statesByType(eng);
  const board = await createBoard(owner, { slug: 'acme', name: 'Acme', teamId: eng.team.id });
  const issue = await createIssue(member, {
    teamId: 'ENG',
    title: 'Dark mode',
    stateId: states.unstarted,
  });
  return { owner, member, eng, states, board, issue };
}

const vote = async (identifier: string, cookie: string, slug = 'acme') =>
  ok(await portal(`boards/${slug}/issues/${identifier}/vote`, { cookie, body: {} }));

const rootComment = async (identifier: string, cookie: string, body: string, slug = 'acme') =>
  (
    await ok(
      await portal(`boards/${slug}/issues/${identifier}/comments`, { cookie, body: { body } }),
    )
  ).comment as Json;

const tick = () => Bun.sleep(5);

async function window<T>(fn: () => Promise<T>): Promise<{ since: Date; until: Date }> {
  const since = new Date();
  await tick();
  await fn();
  await tick();
  return { since, until: new Date() };
}

async function changesFor(requesterId: string, w: { since: Date; until: Date }): Promise<Change[]> {
  return requesterChanges(requesterId, w.since, w.until);
}

async function teamFeedback(as: TestUser, issueId: string, requesterId: string) {
  const { attachmentId } = await ok(
    await instance('feedback/attachment', as, { issueId, requesterId }),
  );
  await gqlData(
    as,
    `mutation ($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
    { input: { issueId, attachmentId, body: 'From a call' } },
  );
}

beforeEach(resetDb);

describe('status changes', () => {
  it('reports a move to another public status once, with from and to', async () => {
    const { member, states, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    const w = await window(() => updateIssue(member, issue.id, { stateId: states.started }));
    const changes = await changesFor(v.requesterId, w);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'status',
      identifier: issue.identifier,
      title: 'Dark mode',
      from: 'planned',
      to: 'inProgress',
      url: expect.stringContaining(`/portal/acme/${issue.identifier}`),
    });
  });

  it('reports nothing when the issue ends where it started', async () => {
    const { member, states, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    const w = await window(async () => {
      for (let i = 0; i < 6; i++) {
        await updateIssue(member, issue.id, { stateId: states.started });
        await updateIssue(member, issue.id, { stateId: states.unstarted });
      }
    });
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });

  it('does not report a move within one public status', async () => {
    const { member, states, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    const w = await window(() => updateIssue(member, issue.id, { stateId: states.backlog }));
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });

  it('reports reopening a done issue', async () => {
    const { member, states, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    await updateIssue(member, issue.id, { stateId: states.completed });
    const w = await window(() => updateIssue(member, issue.id, { stateId: states.started }));
    expect(await changesFor(v.requesterId, w)).toMatchObject([
      { kind: 'status', from: 'done', to: 'inProgress' },
    ]);
  });

  it('reports a duplicate as closed with the issue it duplicates', async () => {
    const { member, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    const other = await createIssue(member, { teamId: 'ENG', title: 'Theme support' });
    const w = await window(() =>
      gqlData(
        member,
        `mutation ($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
        { input: { issueId: issue.id, relatedIssueId: other.id, type: 'duplicate' } },
      ),
    );
    const changes = await changesFor(v.requesterId, w);
    expect(changes).toMatchObject([
      {
        kind: 'status',
        to: 'closed',
        duplicateOf: {
          title: 'Theme support',
          url: expect.stringContaining(`/portal/acme/${other.identifier}`),
        },
      },
    ]);
    // A closed issue is on no board, so the change itself has no link.
    expect(changes[0]).toMatchObject({ url: null });
  });

  it('leaves out a private team’s issues', async () => {
    const { owner, member, states, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    await vote(issue.identifier, v.cookie);
    await makePrivate(owner, 'ENG');
    const w = await window(() => updateIssue(member, issue.id, { stateId: states.started }));
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });

  it('reports status for team-logged feedback on an issue no board shows, without a link', async () => {
    const { owner, member } = await setup();
    const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
    await addMember(owner, 'OPS', member.userId);
    const offBoard = await createIssue(member, {
      teamId: 'OPS',
      title: 'Invoice export',
      stateId: statesByType(ops).unstarted,
    });
    const jane = (
      await ok(await instance('requesters/create', owner, { name: 'Jane', email: 'jane@x.com' }))
    ).requester as Json;
    await teamFeedback(member, offBoard.id, jane.id);
    const w = await window(() =>
      updateIssue(member, offBoard.id, { stateId: statesByType(ops).started }),
    );
    expect(await changesFor(jane.id, w)).toMatchObject([
      { kind: 'status', title: 'Invoice export', to: 'inProgress', url: null },
    ]);
  });

  it('stops reporting votes on an issue the person can no longer read', async () => {
    const { owner, member, eng, states, issue } = await setup();
    const restricted = await createBoard(owner, {
      slug: 'vip',
      name: 'VIP',
      teamId: eng.team.id,
      access: 'restricted',
      allowedDomains: ['example.com'],
    });
    await ok(await instance('portal/boards/delete', owner, { id: await boardId(owner, 'acme') }));
    const v = await visitor('vip', 'Jo');
    await vote(issue.identifier, v.cookie, 'vip');
    await ok(
      await instance('portal/boards/update', owner, {
        id: restricted.id,
        allowedDomains: ['else.test'],
      }),
    );
    const w = await window(() => updateIssue(member, issue.id, { stateId: states.started }));
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });
});

async function boardId(owner: TestUser, slug: string): Promise<string> {
  const boards = (await ok(await instance('portal/boards', owner))).boards as Json[];
  return boards.find((b) => b.slug === slug)!.id as string;
}

describe('replies', () => {
  it('reports a member reply in the person’s portal thread, not internal comments', async () => {
    const { member, issue } = await setup();
    const v = await visitor('acme', 'Jo');
    const root = await rootComment(issue.identifier, v.cookie, 'Any news?');
    const w = await window(async () => {
      await createComment(member, { issueId: issue.id, parentId: root.id, body: 'Next week.' });
      await createComment(member, { issueId: issue.id, body: 'Internal note' });
    });
    expect(await changesFor(v.requesterId, w)).toMatchObject([
      { kind: 'reply', identifier: issue.identifier, author: 'Mia', body: 'Next week.' },
    ]);
  });

  it('does not report the person’s own comments', async () => {
    const { issue } = await setup();
    const v = await visitor('acme', 'Jo');
    const w = await window(() => rootComment(issue.identifier, v.cookie, 'Any news?'));
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });

  it('does not report a reply on a board the person lost access to', async () => {
    const { owner, member, eng, issue } = await setup();
    const vip = await createBoard(owner, {
      slug: 'vip',
      name: 'VIP',
      teamId: eng.team.id,
      access: 'restricted',
      allowedDomains: ['example.com'],
    });
    const v = await visitor('vip', 'Jo');
    const root = await rootComment(issue.identifier, v.cookie, 'Any news?', 'vip');
    await ok(
      await instance('portal/boards/update', owner, { id: vip.id, allowedDomains: ['else.test'] }),
    );
    const w = await window(() =>
      createComment(member, { issueId: issue.id, parentId: root.id, body: 'Secret' }),
    );
    expect(await changesFor(v.requesterId, w)).toEqual([]);
  });
});

describe('project updates', () => {
  async function projectSetup() {
    const s = await setup();
    const project = await createProject(s.member, { name: 'Mobile app', teamIds: ['ENG'] });
    const inProject = await createIssue(s.member, {
      teamId: 'ENG',
      title: 'Offline mode',
      projectId: project.id,
      stateId: s.states.unstarted,
    });
    const v = await visitor('acme', 'Jo');
    await vote(inProject.identifier, v.cookie);
    const post = async (body: string) =>
      (
        await gqlData(
          s.member,
          `mutation ($input: ProjectUpdateCreateInput!) {
            projectUpdateCreate(input: $input) { projectUpdate { id } } }`,
          { input: { projectId: project.id, body, health: 'onTrack' } },
        )
      ).projectUpdateCreate.projectUpdate.id as string;
    return { ...s, project, v, post };
  }

  it('reports a shared update and not an unshared one', async () => {
    const { member, v, post } = await projectSetup();
    const w = await window(async () => {
      const shared = await post('Beta ships Friday.');
      await post('Internal: staffing.');
      await ok(await instance('project-updates/share', member, { projectUpdateId: shared }));
    });
    expect(await changesFor(v.requesterId, w)).toMatchObject([
      {
        kind: 'projectUpdate',
        projectName: 'Mobile app',
        health: 'onTrack',
        body: 'Beta ships Friday.',
      },
    ]);
  });

  it("lists a project's shared updates for members and refuses guests", async () => {
    const { owner, member, post, project } = await projectSetup();
    const guest = await signUpAs('guest', { name: 'Guest' });
    await addMember(owner, 'ENG', guest.userId);
    const shared = await post('Beta ships Friday.');
    await post('Internal: staffing.');
    await ok(await instance('project-updates/share', member, { projectUpdateId: shared }));
    expect(
      await ok(await instance(`project-updates/shared?projectId=${project.id}`, member)),
    ).toEqual({
      ids: [shared],
    });
    expect((await instance(`project-updates/shared?projectId=${project.id}`, guest)).status).toBe(
      403,
    );
  });

  it('shares once however often it is asked, and refuses guests', async () => {
    const { owner, member, v, post } = await projectSetup();
    const guest = await signUpAs('guest', { name: 'Guest' });
    await addMember(owner, 'ENG', guest.userId);
    const w = await window(async () => {
      const id = await post('Beta ships Friday.');
      await ok(await instance('project-updates/share', member, { projectUpdateId: id }));
      await ok(await instance('project-updates/share', member, { projectUpdateId: id }));
      const res = await instance('project-updates/share', guest, { projectUpdateId: id });
      expect(res.status).toBe(403);
    });
    expect(await changesFor(v.requesterId, w)).toHaveLength(1);
  });
});

describe('candidates', () => {
  it('lists people with changes and leaves out those with updates off or blocked', async () => {
    const { owner, member, states, issue } = await setup();
    const on = await visitor('acme', 'Jo');
    const blocked = await visitor('acme', 'Bo');
    const off = await visitor('acme', 'Al');
    for (const v of [on, blocked, off]) await vote(issue.identifier, v.cookie);
    await ok(await portal('me/updates', { cookie: off.cookie, body: { enabled: false } }));
    await ok(
      await instance('portal/block', owner, { requesterId: blocked.requesterId, blocked: true }),
    );
    const since = new Date();
    await tick();
    await updateIssue(member, issue.id, { stateId: states.started });
    const ids = await requestersWithChangesSince(since);
    expect(ids).toContain(on.requesterId);
    expect(ids).not.toContain(blocked.requesterId);
    expect(ids).not.toContain(off.requesterId);
  });
});
