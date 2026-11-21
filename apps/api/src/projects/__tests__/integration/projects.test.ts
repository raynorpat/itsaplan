import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Projects (Linear's Project) group issues across one or more teams. Issues link
// to one through issue.projectId and must belong to one of its teams. status is
// one of six status types; progress and health are derived from the linked
// issues' states. The activity feed merges the project's own events with the
// activity of its linked issues.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  const columns = view.data!.states;
  const stateId = columns[0].id;
  const doneColumnId = columns.find((c) => c.stateType === 'completed')!.id;
  return { owner, asOwner, stateId, doneColumnId, teamId: view.data!.team.id };
}

async function teamIdOf(api: Api, teamKey: string): Promise<string> {
  return (await api.teams({ teamKey }).get()).data!.team.id;
}

// The project list and counts filtered to one team, as the Projects area does.
const projects = (api: Api, teamKey = 'MKT') => ({
  get: (opts: { query?: Record<string, string | number> } = {}) =>
    api.projects.get({ query: { teamKey, ...(opts.query ?? {}) } }),
  counts: { get: () => api.projects.counts.get({ query: { teamKey } }) },
});

async function createProject(
  api: Api,
  body: { name: string } & Record<string, unknown>,
  teamKeys: string[] = ['MKT'],
) {
  const teamIds = await Promise.all(teamKeys.map((k) => teamIdOf(api, k)));
  return api.projects.post({ teamIds, ...body } as Parameters<typeof api.projects.post>[0]);
}

// Adds a fresh user to the team as a member on the given role (default role when
// roleId is omitted).
async function addMember(owner: Api, teamKey: string, roleId?: string) {
  const user = await signUpTestUser();
  const invite = await owner
    .teams({ teamKey })
    .invites.post({ email: user.email, role: 'member', ...(roleId ? { roleId } : {}) });
  const api = authedApi(user.cookie);
  await api.invites({ token: invite.data!.token }).accept.post();
  return { user, api };
}

describe('projects', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates an project with defaults and lists it', async () => {
      const { asOwner } = await setup();
      const created = await createProject(asOwner, { name: 'Q3 Launch' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'Q3 Launch',
        status: 'backlog',
        leadUserId: null,
        priority: 0,
        progress: { completed: 0, total: 0, canceled: 0 },
        health: null,
      });
      expect(typeof created.data?.id).toBe('string');

      const list = await projects(asOwner).get();
      expect(list.data!.items.map((i) => i.name)).toEqual(['Q3 Launch']);
      expect(list.data!.total).toBe(1);
    });

    it('stores the provided fields', async () => {
      const { asOwner } = await setup();
      const created = await createProject(asOwner, {
        name: 'Growth',
        status: 'started',
        priority: 2,
        targetDate: '2026-09-01',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ status: 'started', priority: 2 });
      // Eden Treaty revives the ISO date string into a Date; assert the value.
      expect(new Date(created.data!.targetDate as unknown as string).toISOString()).toStartWith(
        '2026-09-01',
      );
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setup();
      const res = await createProject(asOwner, { name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects an invalid status', async () => {
      const { asOwner } = await setup();
      const res = await createProject(asOwner, { name: 'X', status: 'shipping' });
      expect(res.status).toBe(400);
    });

    it('rejects a lead from outside the team and an unknown label before creating', async () => {
      const { asOwner } = await setup();
      const outsider = await signUpTestUser({ name: 'Outsider' });

      const badLead = await createProject(asOwner, {
        name: 'Bad lead',
        leadUserId: outsider.userId,
      });
      const badLabel = await createProject(asOwner, {
        name: 'Bad label',
        labelIds: ['00000000-0000-4000-8000-000000000000'],
      });

      expect(badLead.status).toBe(400);
      expect(badLabel.status).toBe(400);
      expect((await projects(asOwner).get()).data!.items).toHaveLength(0);
    });
  });

  describe('list filter', () => {
    it('filters by a comma-separated status set', async () => {
      const { asOwner } = await setup();
      await createProject(asOwner, { name: 'A', status: 'started' });
      await createProject(asOwner, { name: 'P', status: 'planned' });
      await createProject(asOwner, { name: 'Pr', status: 'backlog' });

      const active = await projects(asOwner).get({ query: { status: 'started' } });
      expect(active.data!.items.map((i) => i.name)).toEqual(['A']);

      const planned = await projects(asOwner).get({ query: { status: 'backlog,planned' } });
      expect(planned.data!.items.map((i) => i.name).sort()).toEqual(['P', 'Pr']);
    });

    it('matches the name case-insensitively with search', async () => {
      const { asOwner } = await setup();
      await createProject(asOwner, { name: 'Growth loops' });
      await createProject(asOwner, { name: 'Retention' });

      const res = await projects(asOwner).get({ query: { search: 'GROWTH' } });
      expect(res.data!.items.map((i) => i.name)).toEqual(['Growth loops']);
      expect(res.data!.total).toBe(1);
    });
  });

  describe('list sort and paging', () => {
    it('sorts by name and reverses with dir', async () => {
      const { asOwner } = await setup();
      await createProject(asOwner, { name: 'B' });
      await createProject(asOwner, { name: 'A' });
      await createProject(asOwner, { name: 'C' });

      const asc = await projects(asOwner).get({ query: { sort: 'name' } });
      expect(asc.data!.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);

      const desc = await projects(asOwner).get({ query: { sort: 'name', dir: 'desc' } });
      expect(desc.data!.items.map((i) => i.name)).toEqual(['C', 'B', 'A']);
    });

    it('sorts by priority severity, unset last', async () => {
      const { asOwner } = await setup();
      await createProject(asOwner, { name: 'none' });
      await createProject(asOwner, { name: 'low', priority: 4 });
      await createProject(asOwner, { name: 'urgent', priority: 1 });

      const res = await projects(asOwner).get({ query: { sort: 'priority' } });
      expect(res.data!.items.map((i) => i.name)).toEqual(['urgent', 'low', 'none']);
    });

    it('pages with page and pageSize and reports the full total', async () => {
      const { asOwner } = await setup();
      for (const name of ['A', 'B', 'C']) await createProject(asOwner, { name });

      const first = await projects(asOwner).get({
        query: { sort: 'name', page: 1, pageSize: 2 },
      });
      expect(first.data!.items.map((i) => i.name)).toEqual(['A', 'B']);
      expect(first.data!.total).toBe(3);

      const second = await projects(asOwner).get({
        query: { sort: 'name', page: 2, pageSize: 2 },
      });
      expect(second.data!.items.map((i) => i.name)).toEqual(['C']);
      expect(second.data!.total).toBe(3);
    });
  });

  describe('counts', () => {
    it('returns per-status counts for the tabs', async () => {
      const { asOwner } = await setup();
      await createProject(asOwner, { name: 'a1', status: 'started' });
      await createProject(asOwner, { name: 'a2', status: 'started' });
      await createProject(asOwner, { name: 'p', status: 'planned' });
      await createProject(asOwner, { name: 'c', status: 'completed' });

      const res = await projects(asOwner).counts.get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        total: 4,
        backlog: 0,
        planned: 1,
        started: 2,
        paused: 0,
        completed: 1,
        canceled: 0,
      });
    });
  });

  describe('get', () => {
    it('returns an project by id', async () => {
      const { asOwner } = await setup();
      const created = (await createProject(asOwner, { name: 'Q3' })).data!;
      const got = await asOwner.projects({ projectId: created.id }).get();
      expect(got.status).toBe(200);
      expect(got.data).toMatchObject({ id: created.id, name: 'Q3' });
    });

    it('returns 404 for a missing project', async () => {
      const { asOwner } = await setup();
      const res = await asOwner
        .projects({ projectId: '00000000-0000-4000-8000-000000000000' })
        .get();
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    it('updates fields', async () => {
      const { asOwner } = await setup();
      const created = (await createProject(asOwner, { name: 'Q3' })).data!;

      const patched = await asOwner.projects({ projectId: created.id }).patch({
        name: 'Q3 Launch',
        status: 'started',
      });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ name: 'Q3 Launch', status: 'started' });
    });

    it('returns 404 for a missing project', async () => {
      const { asOwner } = await setup();
      const res = await asOwner
        .projects({ projectId: '00000000-0000-4000-8000-000000000000' })
        .patch({ name: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('delete', () => {
    it('deletes the project but keeps its linked issues (unlinked)', async () => {
      const { asOwner, stateId } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const issue = (
        await asOwner
          .teams({ teamKey: 'MKT' })
          .issues.post({ stateId, title: 'Task', projectId: project.id })
      ).data!;

      const del = await asOwner.projects({ projectId: project.id }).delete();
      expect(del.status).toBe(204);

      const gone = await asOwner.projects({ projectId: project.id }).get();
      expect(gone.status).toBe(404);

      // The issue survives, with its project link cleared.
      const survivor = await asOwner.issues({ issueId: issue.id }).get();
      expect(survivor.status).toBe(200);
      expect(survivor.data?.project).toBeNull();
    });
  });

  describe('linked issues, progress and health', () => {
    it('counts linked issues and reflects completion in progress', async () => {
      const { asOwner, stateId, doneColumnId } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3', targetDate: '2026-09-01' }))
        .data!;
      const scope = asOwner.teams({ teamKey: 'MKT' }).issues;
      const a = (await scope.post({ stateId, title: 'A', projectId: project.id })).data!;
      await scope.post({ stateId, title: 'B', projectId: project.id });

      let got = await asOwner.projects({ projectId: project.id }).get();
      expect(got.data?.progress).toMatchObject({ completed: 0, total: 2 });

      // Move one issue to the completed column.
      await asOwner.issues({ issueId: a.id }).patch({ stateId: doneColumnId });
      got = await asOwner.projects({ projectId: project.id }).get();
      expect(got.data?.progress).toMatchObject({ completed: 1, total: 2 });
      expect(typeof got.data?.computedHealth).toBe('string');
    });

    it('links and unlinks an issue through update_issue', async () => {
      const { asOwner, stateId } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const issue = (
        await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' })
      ).data!;

      await asOwner.issues({ issueId: issue.id }).patch({ projectId: project.id });
      let got = await asOwner.projects({ projectId: project.id }).get();
      expect(got.data?.progress.total).toBe(1);

      await asOwner.issues({ issueId: issue.id }).patch({ projectId: null });
      got = await asOwner.projects({ projectId: project.id }).get();
      expect(got.data?.progress.total).toBe(0);
    });

    it("rejects linking an issue to a project that does not include the issue's team", async () => {
      const { asOwner, stateId } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const otherProject = (await createProject(asOwner, { name: 'Other' }, ['OPS'])).data!;
      const issue = (
        await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' })
      ).data!;

      const res = await asOwner.issues({ issueId: issue.id }).patch({ projectId: otherProject.id });
      expect(res.status).toBe(400);
    });
  });

  describe('feed', () => {
    it("records the project's own events and its linked issues' activity", async () => {
      const { asOwner, stateId } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      await asOwner.projects({ projectId: project.id }).patch({ status: 'started' });

      const issue = (
        await asOwner
          .teams({ teamKey: 'MKT' })
          .issues.post({ stateId, title: 'Task', projectId: project.id })
      ).data!;
      await asOwner.issues({ issueId: issue.id }).patch({ title: 'Renamed' });

      const feed = await asOwner.projects({ projectId: project.id }).feed.get();
      expect(feed.status).toBe(200);
      const actions = feed.data!.items.map((i) => i.action);
      // Project-level events (created, status change) and issue activity are merged.
      expect(actions).toContain('created');
      expect(actions).toContain('status');
      expect(actions).toContain('title');
      // Issue rows carry the source 'issue' and an identifier; project rows do not.
      const issueRow = feed.data!.items.find((i) => i.action === 'title');
      expect(issueRow?.source).toBe('issue');
      expect(issueRow?.issueId).toBe(issue.id);
      expect(issueRow?.issueIdentifier).toMatch(/^MKT-\d+$/);
    });

    it('exposes a change marker that moves after an edit', async () => {
      const { asOwner } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const before = (await asOwner.projects({ projectId: project.id }).rev.get()).data!.rev;
      await asOwner.projects({ projectId: project.id }).patch({ status: 'started' });
      const after = (await asOwner.projects({ projectId: project.id }).rev.get()).data!.rev;
      expect(after).not.toBe(before);
    });
  });

  describe('fields, statuses and archive', () => {
    it('lists the six project statuses', async () => {
      const { asOwner } = await setup();
      const res = await asOwner['project-statuses'].get();
      expect(res.data!.map((s) => s.type)).toEqual([
        'backlog',
        'planned',
        'started',
        'paused',
        'completed',
        'canceled',
      ]);
      expect(res.data!.find((s) => s.type === 'started')?.name).toBe('In Progress');
    });

    it('gives each project a unique 12-hex slugId', async () => {
      const { asOwner } = await setup();
      const a = (await createProject(asOwner, { name: 'A' })).data!;
      const b = (await createProject(asOwner, { name: 'B' })).data!;
      expect(a.slugId).toMatch(/^[0-9a-f]{12}$/);
      expect(a.slugId).not.toBe(b.slugId);
    });

    it('rejects a priority outside 0..4', async () => {
      const { asOwner } = await setup();
      expect((await createProject(asOwner, { name: 'x', priority: 5 })).status).toBe(400);
    });

    it('archives a project out of the list and unarchives it', async () => {
      const { asOwner } = await setup();
      const project = (await createProject(asOwner, { name: 'Old' })).data!;
      const archived = await asOwner.projects({ projectId: project.id }).archive.post();
      expect(archived.status).toBe(200);
      expect(archived.data!.archivedAt).toBeTruthy();
      expect((await projects(asOwner).get()).data!.items).toHaveLength(0);
      const all = await projects(asOwner).get({ query: { includeArchived: 'true' } });
      expect(all.data!.items.map((p) => p.id)).toEqual([project.id]);

      const restored = await asOwner.projects({ projectId: project.id }).unarchive.post();
      expect(restored.data!.archivedAt).toBeNull();
      expect((await projects(asOwner).get()).data!.items).toHaveLength(1);
    });
  });

  describe('access', () => {
    it('refuses to create a project in a team the user cannot create in', async () => {
      const { asOwner, teamId } = await setup();
      const outsider = authedApi((await signUpTestUser()).cookie);
      const res = await outsider.projects.post({ name: 'x', teamIds: [teamId] });
      expect(res.status).toBe(403);
      const unknown = await asOwner.projects.post({
        name: 'x',
        teamIds: ['00000000-0000-4000-8000-000000000000'],
      });
      expect(unknown.status).toBe(403);
    });

    it('hides a project from a non-member', async () => {
      const { asOwner } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      expect((await projects(outsider).get()).data!.items).toHaveLength(0);
      expect((await outsider.projects({ projectId: project.id }).get()).status).toBe(404);
      expect((await outsider.projects({ projectId: project.id }).patch({ name: 'x' })).status).toBe(
        404,
      );
      expect((await outsider.projects({ projectId: project.id }).delete()).status).toBe(404);
    });

    it('hides a project from a member whose role cannot read projects', async () => {
      const { asOwner } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const role = await asOwner
        .teams({ teamKey: 'MKT' })
        .roles.post({ name: 'Blind', permissions: {} });
      const member = await addMember(asOwner, 'MKT', role.data!.id);
      expect((await projects(member.api).get()).data!.items).toHaveLength(0);
      expect((await member.api.projects({ projectId: project.id }).get()).status).toBe(404);
    });
  });

  describe('teams', () => {
    it('creates a project in two teams and lists it under both', async () => {
      const { asOwner } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const created = await createProject(asOwner, { name: 'Shared' }, ['MKT', 'OPS']);
      expect(created.status).toBe(201);
      expect(created.data!.teams.map((t) => t.key).sort()).toEqual(['MKT', 'OPS']);
      expect((await projects(asOwner, 'MKT').get()).data!.items.map((p) => p.id)).toEqual([
        created.data!.id,
      ]);
      expect((await projects(asOwner, 'OPS').get()).data!.items.map((p) => p.id)).toEqual([
        created.data!.id,
      ]);
    });

    it('needs the create permission in every team listed', async () => {
      const { asOwner } = await setup();
      const other = authedApi((await signUpTestUser()).cookie);
      await other.teams.post({ key: 'OPS', name: 'Operations' });
      const opsId = await teamIdOf(other, 'OPS');
      const mktId = await teamIdOf(asOwner, 'MKT');
      const res = await asOwner.projects.post({ name: 'x', teamIds: [mktId, opsId] });
      expect(res.status).toBe(403);
    });

    it('shows a member only the teams they can access, and keeps hidden teams on replace', async () => {
      const { asOwner } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      await asOwner.teams.post({ key: 'DES', name: 'Design' });
      const project = (await createProject(asOwner, { name: 'Shared' }, ['MKT', 'OPS'])).data!;
      const member = await addMember(asOwner, 'MKT');
      // The MKT member also joins DES, so they can attach it.
      const des = await asOwner.teams({ teamKey: 'DES' }).invites.post({
        email: member.user.email,
        role: 'member',
      });
      await member.api.invites({ token: des.data!.token }).accept.post();

      const seen = await member.api.projects({ projectId: project.id }).get();
      expect(seen.data!.teams.map((t) => t.key)).toEqual(['MKT']);

      const desId = await teamIdOf(asOwner, 'DES');
      const mktId = await teamIdOf(asOwner, 'MKT');
      const res = await member.api.projects({ projectId: project.id }).teams.put({
        teamIds: [mktId, desId],
      });
      expect(res.status).toBe(200);
      const full = await asOwner.projects({ projectId: project.id }).get();
      expect(full.data!.teams.map((t) => t.key).sort()).toEqual(['DES', 'MKT', 'OPS']);
    });

    it('refuses to remove a team whose issues are in the project, and the last team', async () => {
      const { asOwner, stateId } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const project = (await createProject(asOwner, { name: 'Shared' }, ['MKT', 'OPS'])).data!;
      await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.post({ stateId, title: 'Task', projectId: project.id });
      const opsId = await teamIdOf(asOwner, 'OPS');
      const mktId = await teamIdOf(asOwner, 'MKT');

      const dropMkt = await asOwner
        .projects({ projectId: project.id })
        .teams.put({ teamIds: [opsId] });
      expect(dropMkt.status).toBe(409);
      const dropAll = await asOwner.projects({ projectId: project.id }).teams.put({ teamIds: [] });
      expect(dropAll.status).toBe(409);
      const dropOps = await asOwner
        .projects({ projectId: project.id })
        .teams.put({ teamIds: [mktId] });
      expect(dropOps.status).toBe(200);
    });

    it('refuses an issue from a team the project does not include', async () => {
      const { asOwner } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      await asOwner.teams.post({ key: 'DES', name: 'Design' });
      const project = (await createProject(asOwner, { name: 'Shared' }, ['MKT', 'OPS'])).data!;
      const desState = (await asOwner.teams({ teamKey: 'DES' }).get()).data!.states[0].id;
      const res = await asOwner
        .teams({ teamKey: 'DES' })
        .issues.post({ stateId: desState, title: 'x', projectId: project.id });
      expect(res.status).toBe(400);
    });

    it("deletes a team's own projects with it and keeps shared ones", async () => {
      const { asOwner } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const own = (await createProject(asOwner, { name: 'Only OPS' }, ['OPS'])).data!;
      const shared = (await createProject(asOwner, { name: 'Shared' }, ['MKT', 'OPS'])).data!;

      const del = await asOwner.teams({ teamKey: 'OPS' }).delete();
      expect(del.status).toBe(204);

      expect((await asOwner.projects({ projectId: own.id }).get()).status).toBe(404);
      const kept = await asOwner.projects({ projectId: shared.id }).get();
      expect(kept.status).toBe(200);
      expect(kept.data!.teams.map((t) => t.key)).toEqual(['MKT']);
    });

    it('requires the lead to be a member of one of the teams', async () => {
      const { asOwner } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const opsMember = await addMember(asOwner, 'OPS');
      const outsider = await signUpTestUser();
      const ok = await createProject(asOwner, { name: 'A', leadUserId: opsMember.user.userId }, [
        'MKT',
        'OPS',
      ]);
      expect(ok.status).toBe(201);
      const bad = await createProject(asOwner, { name: 'B', leadUserId: outsider.userId });
      expect(bad.status).toBe(400);
    });
  });
});
