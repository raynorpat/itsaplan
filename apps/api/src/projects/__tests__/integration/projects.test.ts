import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Projects are a team-scoped grouping of issues. Issues link to one through
// issue.projectId. status is a fixed lifecycle enum; progress and health are
// derived from the linked issues' states and are not stored. The activity feed
// merges the project's own events with the activity of its linked issues.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  const columns = view.data!.states;
  const stateId = columns[0].id;
  const doneColumnId = columns.find((c) => c.stateType === 'completed')!.id;
  return { owner, asOwner, stateId, doneColumnId };
}

const projects = (api: Api) => api.teams({ teamKey: 'MKT' }).projects;

function createProject(api: Api, body: { name: string } & Record<string, unknown>) {
  return projects(api).post(body);
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
      expect(typeof got.data?.health).toBe('string');
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

    it('rejects linking an issue to an project from another team', async () => {
      const { asOwner, stateId } = await setup();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const otherProject = (
        await asOwner.teams({ teamKey: 'OPS' }).projects.post({ name: 'Other' })
      ).data!;
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

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setup();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).projects.post({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('denies a non-member on the project routes', async () => {
      const { asOwner } = await setup();
      const project = (await createProject(asOwner, { name: 'Q3' })).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      expect((await outsider.teams({ teamKey: 'MKT' }).projects.post({ name: 'x' })).status).toBe(
        403,
      );
      expect((await outsider.teams({ teamKey: 'MKT' }).projects.get()).status).toBe(403);
      expect((await outsider.projects({ projectId: project.id }).get()).status).toBe(403);
      expect((await outsider.projects({ projectId: project.id }).patch({ name: 'x' })).status).toBe(
        403,
      );
      expect((await outsider.projects({ projectId: project.id }).delete()).status).toBe(403);
    });
  });
});
