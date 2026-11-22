import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Issues live under a team. Create is /teams/:teamKey/issues (permission
// guard on :teamKey); the other routes address the issue by its own id
// (/issues/:issueId) and resolve access through the workItem guard. An issue is
// read back through GET /issues/:issueId or through
// the team view (GET /teams/:teamKey → `issues`, which carries labelIds
// and set field values). createTeam seeds five default columns.

interface Setup {
  asOwner: Api;
  stateId: string;
  stateIds: string[];
}

// A fresh team plus the ids of its seeded columns. stateIds[0] is used as the
// default target column for created issues.
async function setupTeam(): Promise<Setup> {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  const stateIds = view.data!.states.map((c) => c.id);
  return { asOwner, stateId: stateIds[0], stateIds };
}

function createIssue(client: Api, stateId: string, patch: Record<string, unknown> = {}) {
  return client.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task', ...patch });
}

// A label of a second team, which no issue of the first one may carry.
async function foreignLabel(client: Api) {
  await client.teams.post({ key: 'OPS', name: 'Operations' });
  const res = await client.teams({ teamKey: 'OPS' }).labels.post({ name: 'ops-secret' });
  return res.data!;
}

// A column of a second team, which no issue of the first one may point at.
async function foreignTeam(client: Api) {
  await client.teams.post({ key: 'OPS', name: 'Operations' });
  const view = await client.teams({ teamKey: 'OPS' }).get();
  return { stateId: view.data!.states[0].id };
}

// The board's issue list (carries labelIds).
async function issuesOf(client: Api, teamKey = 'MKT') {
  const board = await client.teams({ teamKey }).issues.board.get();
  return board.data!.issues;
}

describe('issues', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates an issue and returns it with an identifier and position', async () => {
      const { asOwner, stateId } = await setupTeam();

      const created = await createIssue(asOwner, stateId, { title: 'Ship the docs' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        title: 'Ship the docs',
        stateId,
        description: '',
        labelIds: [],
      });
      expect(created.data?.identifier).toMatch(/^MKT-\d+$/);
      expect(typeof created.data?.id).toBe('string');
      expect(typeof created.data?.position).toBe('number');

      const list = await issuesOf(asOwner);
      expect(list.map((i) => i.id)).toContain(created.data!.id);
    });

    it('returns the linked project expanded to id and title', async () => {
      const { asOwner, stateId } = await setupTeam();
      const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
      const project = (await asOwner.projects.post({ name: 'Q3 Launch', teamIds: [teamId] })).data!;

      const created = await createIssue(asOwner, stateId, { projectId: project.id });
      expect(created.status).toBe(201);
      expect(created.data?.project).toEqual({ id: project.id, title: 'Q3 Launch' });

      // The board payload carries the same expanded shape.
      const onBoard = (await issuesOf(asOwner)).find((i) => i.id === created.data!.id);
      expect(onBoard?.project).toEqual({ id: project.id, title: 'Q3 Launch' });
    });

    it('defaults priority to 0 (no priority)', async () => {
      const { asOwner, stateId } = await setupTeam();
      const created = await createIssue(asOwner, stateId, { title: 'Plain' });
      expect(created.data).toMatchObject({ priority: 0 });
    });

    it('rejects a priority outside 0..4', async () => {
      const { asOwner, stateId } = await setupTeam();
      expect((await createIssue(asOwner, stateId, { priority: 5 })).status).toBe(400);
      expect((await createIssue(asOwner, stateId, { priority: -1 })).status).toBe(400);
    });

    it('stores the optional fields when provided', async () => {
      const { asOwner, stateId } = await setupTeam();
      const created = await createIssue(asOwner, stateId, {
        title: 'With details',
        description: 'the body',
        priority: 2,
        startDate: '2026-01-01',
        dueDate: '2026-02-01',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ description: 'the body', priority: 2 });
      // `date` columns come back as 'YYYY-MM-DD', which Eden Treaty revives into a Date.
      expect(new Date(created.data!.startDate!).getTime()).toBe(new Date('2026-01-01').getTime());
      expect(new Date(created.data!.dueDate!).getTime()).toBe(new Date('2026-02-01').getTime());
    });

    it('hands out an increasing per-team sequence number', async () => {
      const { asOwner, stateId } = await setupTeam();
      const first = (await createIssue(asOwner, stateId)).data!;
      const second = (await createIssue(asOwner, stateId)).data!;

      const seq = (id: string) => Number(id.split('-')[1]);
      expect(seq(second.identifier)).toBe(seq(first.identifier) + 1);
    });

    it('gives a later issue in the same column a higher position', async () => {
      const { asOwner, stateId } = await setupTeam();
      const first = (await createIssue(asOwner, stateId)).data!;
      const second = (await createIssue(asOwner, stateId)).data!;
      expect(second.position).toBeGreaterThan(first.position);
    });

    it('attaches labels passed as labelIds', async () => {
      const { asOwner, stateId } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'bug' })).data!;

      const created = await createIssue(asOwner, stateId, { labelIds: [label.id] });
      expect(created.status).toBe(201);
      expect(created.data?.labelIds).toEqual([label.id]);

      // The team view also reports the label on the issue.
      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === created.data!.id)?.labelIds).toEqual([label.id]);
    });

    it('rejects a label of another team and creates no issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const foreign = await foreignLabel(asOwner);

      const created = await createIssue(asOwner, stateId, { labelIds: [foreign.id] });
      expect(created.status).toBe(400);
      expect(await issuesOf(asOwner)).toHaveLength(0);
    });

    it('rejects a column of another team and creates no issue', async () => {
      const { asOwner } = await setupTeam();
      const foreign = await foreignTeam(asOwner);

      const created = await createIssue(asOwner, foreign.stateId);
      expect(created.status).toBe(400);
      expect(await issuesOf(asOwner)).toHaveLength(0);
    });

    it('rejects an empty title', async () => {
      const { asOwner, stateId } = await setupTeam();
      const res = await createIssue(asOwner, stateId, { title: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a missing stateId', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.post({ title: 'No column' } as unknown as { stateId: string; title: string });
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown team', async () => {
      const { asOwner, stateId } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).issues.post({ stateId, title: 'X' });
      expect(res.status).toBe(404);
    });
  });

  // Linear's issue fields: sub-issues, estimate, creator, and the status timestamps.
  describe('linear fields', () => {
    async function columnsByType(client: Api) {
      const view = await client.teams({ teamKey: 'MKT' }).get();
      const byType: Record<string, string> = {};
      for (const c of view.data!.states) byType[c.stateType] ??= c.id;
      return byType;
    }

    it('sets startedAt on create in a started column', async () => {
      const { asOwner } = await setupTeam();
      const col = await columnsByType(asOwner);
      const created = (await createIssue(asOwner, col.started)).data!;
      expect(created.startedAt).toBeTruthy();
      expect(created.completedAt).toBeNull();
    });

    it('sets completedAt on completing and clears all on moving to backlog', async () => {
      const { asOwner } = await setupTeam();
      const col = await columnsByType(asOwner);
      const issue = (await createIssue(asOwner, col.started)).data!;

      const done = await asOwner.issues({ issueId: issue.id }).patch({ stateId: col.completed });
      expect(done.data!.completedAt).toBeTruthy();
      expect(done.data!.startedAt).toBeTruthy();

      const back = await asOwner.issues({ issueId: issue.id }).patch({ stateId: col.backlog });
      expect(back.data).toMatchObject({ startedAt: null, completedAt: null, canceledAt: null });
    });

    it('sets canceledAt on canceling', async () => {
      const { asOwner } = await setupTeam();
      const col = await columnsByType(asOwner);
      const issue = (await createIssue(asOwner, col.backlog)).data!;
      const res = await asOwner.issues({ issueId: issue.id }).patch({ stateId: col.canceled });
      expect(res.data!.canceledAt).toBeTruthy();
    });

    it('records the creating user as creator', async () => {
      const owner = await signUpTestUser();
      const asOwner = authedApi(owner.cookie);
      await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
      const col = await columnsByType(asOwner);
      const created = (await createIssue(asOwner, col.backlog)).data!;
      expect(created.creatorUserId).toBe(owner.userId);
    });

    it('stores and updates an estimate', async () => {
      const { asOwner, stateId } = await setupTeam();
      const created = (await createIssue(asOwner, stateId, { estimate: 3 })).data!;
      expect(created.estimate).toBe(3);
      const res = await asOwner.issues({ issueId: created.id }).patch({ estimate: null });
      expect(res.data!.estimate).toBeNull();
    });

    it('links a sub-issue to its parent', async () => {
      const { asOwner, stateId } = await setupTeam();
      const parent = (await createIssue(asOwner, stateId, { title: 'Parent' })).data!;
      const child = await createIssue(asOwner, stateId, { title: 'Child', parentId: parent.id });
      expect(child.status).toBe(201);
      expect(child.data!.parentId).toBe(parent.id);
    });

    it('rejects a parent from another team', async () => {
      const { asOwner, stateId } = await setupTeam();
      const other = await foreignTeam(asOwner);
      const foreign = (
        await asOwner
          .teams({ teamKey: 'OPS' })
          .issues.post({ stateId: other.stateId, title: 'Foreign' })
      ).data!;
      const res = await createIssue(asOwner, stateId, { parentId: foreign.id });
      expect(res.status).toBe(400);
    });

    it('rejects an issue as its own parent', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const res = await asOwner.issues({ issueId: issue.id }).patch({ parentId: issue.id });
      expect(res.status).toBe(400);
    });

    it('rejects making an issue the child of its own descendant', async () => {
      const { asOwner, stateId } = await setupTeam();
      const top = (await createIssue(asOwner, stateId, { title: 'Top' })).data!;
      const mid = (await createIssue(asOwner, stateId, { title: 'Mid', parentId: top.id })).data!;
      const leaf = (await createIssue(asOwner, stateId, { title: 'Leaf', parentId: mid.id })).data!;
      const res = await asOwner.issues({ issueId: top.id }).patch({ parentId: leaf.id });
      expect(res.status).toBe(400);
    });

    it('clears a parent with null', async () => {
      const { asOwner, stateId } = await setupTeam();
      const parent = (await createIssue(asOwner, stateId)).data!;
      const child = (await createIssue(asOwner, stateId, { parentId: parent.id })).data!;
      const res = await asOwner.issues({ issueId: child.id }).patch({ parentId: null });
      expect(res.data!.parentId).toBeNull();
    });
  });

  describe('get', () => {
    it('returns the issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner.issues({ issueId: issue.id }).get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ id: issue.id, title: 'Task' });
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.issues({ issueId: '00000000-0000-4000-8000-000000000000' }).get();
      expect(res.status).toBe(404);
    });

    it('answers 400 for a feed cursor whose id is not a UUID', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const res = await asOwner
        .issues({ issueId: issue.id })
        .feed.get({ query: { cursor: JSON.stringify({ ts: '2020-01-01', id: 'abc' }) } });
      expect(res.status).toBe(400);
    });

    it('rejects an issue id that is not a UUID', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.issues({ issueId: 'abc' }).get();
      expect(res.status).toBe(400);
    });
  });

  // GET /teams/:teamKey/issues/:sequenceNumber resolves an issue by its
  // human number (the identifier-based URL), including archived ones.
  describe('get by number', () => {
    it('returns the issue matching the team-scoped number', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues({ sequenceNumber: issue.sequenceNumber })
        .get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ id: issue.id, identifier: issue.identifier });
    });

    it('resolves an archived issue too', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).archive.post();

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues({ sequenceNumber: issue.sequenceNumber })
        .get();
      expect(res.status).toBe(200);
      expect(res.data?.archivedAt).toBeTruthy();
    });

    it('returns 404 for an unknown number', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).issues({ sequenceNumber: 999999 }).get();
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    it('updates the title', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ title: 'Renamed' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ title: 'Renamed' });

      const read = await asOwner.issues({ issueId: issue.id }).get();
      expect(read.data?.title).toBe('Renamed');
    });

    it('moves the issue to another column', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const target = stateIds[1];
      const issue = (await createIssue(asOwner, stateId)).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ stateId: target });
      expect(patched.status).toBe(200);
      expect(patched.data?.stateId).toBe(target);
    });

    it('reorders the issue within a column', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ position: 5 });
      expect(patched.status).toBe(200);
      expect(patched.data?.position).toBe(5);
    });

    it('replaces the label set', async () => {
      const { asOwner, stateId } = await setupTeam();
      const a = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'a' })).data!;
      const b = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'b' })).data!;
      const issue = (await createIssue(asOwner, stateId, { labelIds: [a.id] })).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [b.id] });
      expect(patched.status).toBe(200);
      expect(patched.data?.labelIds).toEqual([b.id]);

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === issue.id)?.labelIds).toEqual([b.id]);
    });

    it('rejects a label of another team and keeps the current set', async () => {
      const { asOwner, stateId } = await setupTeam();
      const own = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'a' })).data!;
      const foreign = await foreignLabel(asOwner);
      const issue = (await createIssue(asOwner, stateId, { labelIds: [own.id] })).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [foreign.id] });
      expect(patched.status).toBe(400);

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === issue.id)?.labelIds).toEqual([own.id]);
    });

    it('rejects a column of another team and keeps the current one', async () => {
      const { asOwner, stateId } = await setupTeam();
      const foreign = await foreignTeam(asOwner);
      const issue = (await createIssue(asOwner, stateId)).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({
        stateId: foreign.stateId,
      });
      expect(patched.status).toBe(400);

      const read = await asOwner.issues({ issueId: issue.id }).get();
      expect(read.data?.stateId).toBe(stateId);
    });

    it('changes only the given fields', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId, { title: 'Keep', priority: 4 })).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ priority: 2 });
      expect(patched.data).toMatchObject({ title: 'Keep', priority: 2 });
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: '00000000-0000-4000-8000-000000000000' })
        .patch({ title: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty title', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const res = await asOwner.issues({ issueId: issue.id }).patch({ title: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric issue id', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: 'abc' as unknown as number })
        .patch({ title: 'X' });
      expect(res.status).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes the issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const del = await asOwner.issues({ issueId: issue.id }).delete();
      expect(del.status).toBe(204);

      const gone = await asOwner.issues({ issueId: issue.id }).get();
      expect(gone.status).toBe(404);
      const list = await issuesOf(asOwner);
      expect(list.map((i) => i.id)).not.toContain(issue.id);
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: '00000000-0000-4000-8000-000000000000' })
        .delete();
      expect(res.status).toBe(404);
    });
  });

  // POST /issues/:issueId/archive hides the issue from the board (kept, restorable);
  // POST /issues/:issueId/restore brings it back. Archived issues are excluded from
  // the team view's `issues` and listed by GET /teams/:teamKey/issues/archived.
  describe('archive', () => {
    async function archivedOf(client: Api, teamKey = 'MKT') {
      const res = await client.teams({ teamKey }).issues.archived.get();
      return res.data!;
    }

    it('archives an issue: off the board, on the archived list, archivedAt set', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner.issues({ issueId: issue.id }).archive.post();
      expect(res.status).toBe(200);
      expect(res.data?.archivedAt).toBeTruthy();

      expect((await issuesOf(asOwner)).map((i) => i.id)).not.toContain(issue.id);
      expect((await archivedOf(asOwner)).map((i) => i.id)).toContain(issue.id);
    });

    it('restores an archived issue back onto the board', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).archive.post();

      const res = await asOwner.issues({ issueId: issue.id }).restore.post();
      expect(res.status).toBe(200);
      expect(res.data?.archivedAt).toBeNull();

      expect((await issuesOf(asOwner)).map((i) => i.id)).toContain(issue.id);
      expect((await archivedOf(asOwner)).map((i) => i.id)).not.toContain(issue.id);
    });

    it('records an archived entry in the feed', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).archive.post();

      const res = await asOwner.issues({ issueId: issue.id }).feed.get({ query: {} });
      expect(res.data?.items.some((i) => i.action === 'archived')).toBe(true);
    });

    it('returns 404 archiving a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: '00000000-0000-4000-8000-000000000000' })
        .archive.post();
      expect(res.status).toBe(404);
    });

    it('denies archive to a non-member with 403', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);
      const res = await outsider.issues({ issueId: issue.id }).archive.post();
      expect(res.status).toBe(403);
    });
  });

  describe('board', () => {
    it('returns the active issues and a string change marker for a member', async () => {
      const { asOwner, stateId } = await setupTeam();
      await createIssue(asOwner, stateId, { title: 'Task' });

      const res = await asOwner.teams({ teamKey: 'MKT' }).issues.board.get();
      expect(res.status).toBe(200);
      expect(res.data?.issues).toHaveLength(1);
      expect(res.data?.issues[0]).toMatchObject({ title: 'Task' });
      expect(typeof res.data?.rev).toBe('string');
    });

    it('changes the marker when an issue is added', async () => {
      const { asOwner, stateId } = await setupTeam();
      const board = asOwner.teams({ teamKey: 'MKT' }).issues.board;
      const before = (await board.get()).data!.rev;

      await createIssue(asOwner, stateId, { title: 'Task' });

      expect((await board.get()).data!.rev).not.toBe(before);
    });

    it('changes the marker when an project is added', async () => {
      const { asOwner } = await setupTeam();
      const board = asOwner.teams({ teamKey: 'MKT' }).issues.board;
      const before = (await board.get()).data!.rev;

      const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
      await asOwner.projects.post({ name: 'Q3 Launch', teamIds: [teamId] });

      expect((await board.get()).data!.rev).not.toBe(before);
    });

    it('exposes the same marker through the rev endpoint', async () => {
      const { asOwner } = await setupTeam();
      const board = (await asOwner.teams({ teamKey: 'MKT' }).issues.board.get()).data!;
      const rev = (await asOwner.teams({ teamKey: 'MKT' }).issues.rev.get()).data!.rev;
      expect(board.rev).toBe(rev);
    });

    it('denies a non-member with 403', async () => {
      await setupTeam();
      const outsider = authedApi((await signUpTestUser()).cookie);
      const res = await outsider.teams({ teamKey: 'MKT' }).issues.board.get();
      expect(res.status).toBe(403);
    });
  });

  describe('rev', () => {
    it('returns a change marker for the issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner.issues({ issueId: issue.id }).rev.get();
      expect(res.status).toBe(200);
      expect(typeof res.data?.rev).toBe('string');
    });

    it('changes the marker after the issue is updated', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const before = (await asOwner.issues({ issueId: issue.id }).rev.get()).data!.rev;

      await asOwner.issues({ issueId: issue.id }).patch({ title: 'Renamed' });

      const after = (await asOwner.issues({ issueId: issue.id }).rev.get()).data!.rev;
      expect(after).not.toBe(before);
    });

    it('changes the marker after a comment is added', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const before = (await asOwner.issues({ issueId: issue.id }).rev.get()).data!.rev;

      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'note' });

      const after = (await asOwner.issues({ issueId: issue.id }).rev.get()).data!.rev;
      expect(after).not.toBe(before);
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: '00000000-0000-4000-8000-000000000000' })
        .rev.get();
      expect(res.status).toBe(404);
    });

    it('rejects a non-numeric issue id', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.issues({ issueId: 'abc' as unknown as number }).rev.get();
      expect(res.status).toBe(400);
    });
  });

  describe('search', () => {
    // GET /teams/:teamKey/issues/search — the light search behind the command
    // palette. Returns IssueSearchHit rows (no description/field values).
    function search(client: Api, query: Record<string, string | number>, teamKey = 'MKT') {
      return client.teams({ teamKey }).issues.search.get({ query });
    }

    it('matches by title and excludes non-matching issues', async () => {
      const { asOwner, stateId } = await setupTeam();
      const hit = (await createIssue(asOwner, stateId, { title: 'Zephyr rollout' })).data!;
      await createIssue(asOwner, stateId, { title: 'Unrelated task' });

      const res = await search(asOwner, { q: 'zephyr' });
      expect(res.status).toBe(200);
      expect(res.data!.map((i) => i.id)).toEqual([hit.id]);
      expect(res.data![0]).toMatchObject({ identifier: hit.identifier, archived: false });
    });

    it('matches by description', async () => {
      const { asOwner, stateId } = await setupTeam();
      const hit = (
        await createIssue(asOwner, stateId, {
          title: 'Plain',
          description: 'contains quokka word',
        })
      ).data!;
      await createIssue(asOwner, stateId, { title: 'Other' });

      const res = await search(asOwner, { q: 'quokka' });
      expect(res.data!.map((i) => i.id)).toEqual([hit.id]);
    });

    it('always includes archived issues, flagged as archived', async () => {
      const { asOwner, stateId } = await setupTeam();
      const hit = (await createIssue(asOwner, stateId, { title: 'Zephyr rollout' })).data!;
      await asOwner.issues({ issueId: hit.id }).archive.post();

      const res = await search(asOwner, { q: 'zephyr' });
      expect(res.status).toBe(200);
      expect(res.data!.map((i) => i.id)).toEqual([hit.id]);
      expect(res.data![0]).toMatchObject({ archived: true });
    });

    it('matches by issue number, plainly and as KEY-42, but not another key', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId, { title: 'Numbered' })).data!;
      const seq = issue.sequenceNumber;

      expect((await search(asOwner, { q: String(seq) })).data!.map((i) => i.id)).toContain(
        issue.id,
      );
      expect((await search(asOwner, { q: `MKT-${seq}` })).data!.map((i) => i.id)).toContain(
        issue.id,
      );
      // A different team key does not match the number.
      expect((await search(asOwner, { q: `OTHER-${seq}` })).data!.map((i) => i.id)).not.toContain(
        issue.id,
      );
    });

    it('caps the result count at limit', async () => {
      const { asOwner, stateId } = await setupTeam();
      for (let i = 0; i < 3; i++) await createIssue(asOwner, stateId, { title: `Item ${i}` });

      const res = await search(asOwner, { q: 'item', limit: 2 });
      expect(res.data!.length).toBe(2);
    });

    it('matches LIKE metacharacters literally', async () => {
      const { asOwner, stateId } = await setupTeam();
      const hit = (await createIssue(asOwner, stateId, { title: '50% off deal' })).data!;
      await createIssue(asOwner, stateId, { title: 'no discount' });

      const res = await search(asOwner, { q: '50%' });
      expect(res.data!.map((i) => i.id)).toEqual([hit.id]);
    });

    it('does not find issues from another team', async () => {
      const { asOwner, stateId } = await setupTeam();
      await createIssue(asOwner, stateId, { title: 'Kestrel here' });
      await asOwner.teams.post({ key: 'OPS', name: 'Ops' });
      const opsCols = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!.states;
      await asOwner
        .teams({ teamKey: 'OPS' })
        .issues.post({ stateId: opsCols[0].id, title: 'Kestrel there' });

      const res = await search(asOwner, { q: 'kestrel' });
      expect(res.data!.every((i) => i.identifier.startsWith('MKT-'))).toBe(true);
      expect(res.data!.length).toBe(1);
    });

    it('denies a non-member', async () => {
      const { asOwner, stateId } = await setupTeam();
      await createIssue(asOwner, stateId, { title: 'Secret' });
      const outsider = authedApi((await signUpTestUser()).cookie);

      expect((await search(outsider, { q: 'secret' })).status).toBe(403);
    });
  });

  describe('list (filters)', () => {
    // GET /teams/:teamKey/issues — the filtered list (no text query). Same
    // IssueSearchHit rows as search.
    function list(client: Api, query: Record<string, string | number> = {}, teamKey = 'MKT') {
      return client.teams({ teamKey }).issues.get({ query });
    }

    it('treats a placeholder priority 0 as "any"', async () => {
      const { asOwner, stateId } = await setupTeam();
      const urgent = (await createIssue(asOwner, stateId, { priority: 1 })).data!;
      const res = await list(asOwner, { priority: 0 });
      expect(res.data!.map((i) => i.id)).toContain(urgent.id);
    });

    it('lists active issues by default and excludes archived', async () => {
      const { asOwner, stateId } = await setupTeam();
      const active = (await createIssue(asOwner, stateId, { title: 'Active' })).data!;
      const gone = (await createIssue(asOwner, stateId, { title: 'Archived one' })).data!;
      await asOwner.issues({ issueId: gone.id }).archive.post();

      const res = await list(asOwner);
      expect(res.status).toBe(200);
      const ids = res.data!.map((i) => i.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(gone.id);
    });

    it('includes archived when includeArchived is set', async () => {
      const { asOwner, stateId } = await setupTeam();
      const gone = (await createIssue(asOwner, stateId, { title: 'Archived one' })).data!;
      await asOwner.issues({ issueId: gone.id }).archive.post();

      const res = await list(asOwner, { includeArchived: 'true' });
      expect(res.data!.map((i) => i.id)).toContain(gone.id);
      expect(res.data!.find((i) => i.id === gone.id)?.archived).toBe(true);
    });

    it('filters by column id', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const here = (await createIssue(asOwner, stateId, { title: 'Here' })).data!;
      await createIssue(asOwner, stateIds[1], { title: 'Elsewhere' });

      const res = await list(asOwner, { stateId });
      expect(res.data!.map((i) => i.id)).toContain(here.id);
      expect(res.data!.every((i) => i.stateId === stateId)).toBe(true);
    });

    it('applies the labelIds filter with AND semantics', async () => {
      const { asOwner, stateId } = await setupTeam();
      const a = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'a' })).data!;
      const b = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'b' })).data!;
      const both = (await createIssue(asOwner, stateId, { title: 'Both', labelIds: [a.id, b.id] }))
        .data!;
      const onlyA = (await createIssue(asOwner, stateId, { title: 'OnlyA', labelIds: [a.id] }))
        .data!;

      const res = await list(asOwner, { labelIds: `${a.id},${b.id}` });
      const ids = res.data!.map((i) => i.id);
      expect(ids).toContain(both.id);
      expect(ids).not.toContain(onlyA.id);
    });

    it('ignores placeholder 0 ids and empty strings (LLM-filled defaults)', async () => {
      const { asOwner, stateId } = await setupTeam();
      const one = (await createIssue(asOwner, stateId, { title: 'Real one' })).data!;

      // A tool-calling model tends to fill every optional field with a placeholder.
      // An id that is not a UUID must mean "any", not a filter.
      const res = await list(asOwner, {
        stateId: '',
        projectId: '0',
        assigneeUserId: '',
      });
      expect(res.status).toBe(200);
      expect(res.data!.map((i) => i.id)).toContain(one.id);
    });

    it('denies a non-member', async () => {
      const { asOwner, stateId } = await setupTeam();
      await createIssue(asOwner, stateId, { title: 'Secret' });
      const outsider = authedApi((await signUpTestUser()).cookie);

      expect((await list(outsider)).status).toBe(403);
    });
  });

  describe('bulk actions', () => {
    it('applies one patch to every listed issue', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const a = (await createIssue(asOwner, stateId)).data!;
      const b = (await createIssue(asOwner, stateId)).data!;
      const target = stateIds[2];

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.patch({ ids: [a.id, b.id], patch: { stateId: target } });
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ updated: 2 });

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === a.id)?.stateId).toBe(target);
      expect(list.find((i) => i.id === b.id)?.stateId).toBe(target);
    });

    it('adds labels to every listed issue, keeping existing ones', async () => {
      const { asOwner, stateId } = await setupTeam();
      const a = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'a' })).data!;
      const b = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'b' })).data!;
      const one = (await createIssue(asOwner, stateId, { labelIds: [a.id] })).data!;
      const two = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.labels.post({ ids: [one.id, two.id], add: [b.id] });
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ updated: 2 });

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === one.id)?.labelIds.sort()).toEqual([a.id, b.id].sort());
      expect(list.find((i) => i.id === two.id)?.labelIds).toEqual([b.id]);
    });

    it("rejects a bulk move to another team's column", async () => {
      const { asOwner, stateId } = await setupTeam();
      const foreign = await foreignTeam(asOwner);
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.patch({ ids: [issue.id], patch: { stateId: foreign.stateId } });
      expect(res.status).toBe(400);

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === issue.id)?.stateId).toBe(stateId);
    });

    it("rejects a bulk add of another team's label", async () => {
      const { asOwner, stateId } = await setupTeam();
      const foreign = await foreignLabel(asOwner);
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.labels.post({ ids: [issue.id], add: [foreign.id] });
      expect(res.status).toBe(400);

      const list = await issuesOf(asOwner);
      expect(list.find((i) => i.id === issue.id)?.labelIds).toEqual([]);
    });

    it('archives every listed issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const a = (await createIssue(asOwner, stateId)).data!;
      const b = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.archive.post({ ids: [a.id, b.id] });
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ archived: 2 });

      const list = await issuesOf(asOwner);
      expect(list.map((i) => i.id)).not.toContain(a.id);
      expect(list.map((i) => i.id)).not.toContain(b.id);
    });

    it('deletes every listed issue', async () => {
      const { asOwner, stateId } = await setupTeam();
      const a = (await createIssue(asOwner, stateId)).data!;
      const b = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.delete.post({ ids: [a.id, b.id] });
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ deleted: 2 });

      expect((await asOwner.issues({ issueId: a.id }).get()).status).toBe(404);
      expect((await asOwner.issues({ issueId: b.id }).get()).status).toBe(404);
    });

    it('ignores ids that belong to another team', async () => {
      const { asOwner, stateId } = await setupTeam();
      const mine = (await createIssue(asOwner, stateId)).data!;
      // A second team owned by the same user; its issue must not be touched by a
      // bulk action scoped to the first team.
      await asOwner.teams.post({ key: 'OPS', name: 'Ops' });
      const opsColumn = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!.states[0].id;
      const foreign = (
        await asOwner.teams({ teamKey: 'OPS' }).issues.post({ stateId: opsColumn, title: 'X' })
      ).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.archive.post({ ids: [mine.id, foreign.id] });
      expect(res.data).toMatchObject({ archived: 1 });

      // The foreign issue is still on its own board.
      expect((await issuesOf(asOwner, 'OPS')).map((i) => i.id)).toContain(foreign.id);
    });

    it('rejects an empty id list', async () => {
      const { asOwner } = await setupTeam();

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.bulk.patch({ ids: [], patch: { priority: 2 } });
      expect(res.status).toBe(400);
    });

    it('denies a non-member', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      expect(
        (
          await outsider
            .teams({ teamKey: 'MKT' })
            .issues.bulk.patch({ ids: [issue.id], patch: { priority: 2 } })
        ).status,
      ).toBe(403);
      expect(
        (await outsider.teams({ teamKey: 'MKT' }).issues.bulk.delete.post({ ids: [issue.id] }))
          .status,
      ).toBe(403);
    });
  });

  describe('access', () => {
    it('denies a non-member on every issue route', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect(
        (await outsider.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'X' })).status,
      ).toBe(403);
      expect((await outsider.issues({ issueId: issue.id }).get()).status).toBe(403);
      expect((await outsider.issues({ issueId: issue.id }).patch({ title: 'X' })).status).toBe(403);
      expect((await outsider.issues({ issueId: issue.id }).delete()).status).toBe(403);
      expect((await outsider.issues({ issueId: issue.id }).rev.get()).status).toBe(403);
    });
  });
});
