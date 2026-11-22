import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Columns (kanban states). There is no GET /columns route — a column is read back
// through the team view (GET /teams/:teamKey), whose `columns` field is
// listStates(): every column ordered by state type (backlog → unstarted →
// started → completed → canceled), then by position within a type. createTeam
// seeds five default columns, one per state type.

async function setupTeam() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner };
}

// The team's columns in work-items order (state type, then position).
async function columnsOf(client: Api, teamKey = 'MKT') {
  const view = await client.teams({ teamKey }).get();
  return view.data!.states;
}

async function columnByName(client: Api, name: string, teamKey = 'MKT') {
  const cols = await columnsOf(client, teamKey);
  return cols.find((c) => c.name === name)!;
}

function createIssue(client: Api, stateId: string, title = 'Task') {
  return client.teams({ teamKey: 'MKT' }).issues.post({ stateId, title });
}

describe('columns', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates a column with a default color and lists it in the view', async () => {
      const { asOwner } = await setupTeam();

      const created = await asOwner.teams({ teamKey: 'MKT' }).states.post({
        name: 'Review',
        stateType: 'started',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'Review',
        stateType: 'started',
        color: '#6b7280',
      });
      expect(typeof created.data?.id).toBe('string');

      const cols = await columnsOf(asOwner);
      expect(cols.map((c) => c.name)).toContain('Review');
    });

    it('stores a provided color', async () => {
      const { asOwner } = await setupTeam();
      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        .states.post({ name: 'Review', stateType: 'started', color: '#123456' });
      expect(created.data).toMatchObject({ color: '#123456' });
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states.post({ name: '', stateType: 'started' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown state type', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).states.post({
        name: 'Weird',
        stateType: 'nonsense' as unknown as 'started',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('reorder', () => {
    it('reorders columns within a state type', async () => {
      const { asOwner } = await setupTeam();
      const inProgress = await columnByName(asOwner, 'In Progress');
      const review = (
        await asOwner
          .teams({ teamKey: 'MKT' })
          .states.post({ name: 'Review', stateType: 'started' })
      ).data!;

      // Before: the two started columns list as [In Progress, Review] (by
      // position). Reorder to put Review first.
      const reordered = await asOwner
        .teams({ teamKey: 'MKT' })
        .states.reorder.put({ orderedIds: [review.id, inProgress.id] });
      expect(reordered.status).toBe(200);

      const started = reordered.data!.filter((c) => c.stateType === 'started');
      expect(started.map((c) => c.name)).toEqual(['Review', 'In Progress']);
    });

    it('ignores ids that belong to another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const opsBefore = await columnsOf(asOwner, 'OPS');
      const foreignId = opsBefore[0].id;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states.reorder.put({ orderedIds: [foreignId] });
      expect(res.status).toBe(200);
      // The reorder must not touch OPS: its columns keep their order and positions.
      const opsAfter = await columnsOf(asOwner, 'OPS');
      expect(opsAfter.map((c) => c.id)).toEqual(opsBefore.map((c) => c.id));
      expect(opsAfter.map((c) => c.position)).toEqual(opsBefore.map((c) => c.position));
    });

    it('rejects an empty ordered list', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).states.reorder.put({ orderedIds: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('update', () => {
    it('updates the name', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .patch({ name: 'To Do' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ name: 'To Do' });

      const cols = await columnsOf(asOwner);
      expect(cols.find((c) => c.id === todo.id)?.name).toBe('To Do');
    });

    it('moves a column to a different state type', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .patch({ stateType: 'started' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ stateType: 'started' });

      // The view groups by state type, so the former Todo now lists among the
      // started columns.
      const started = (await columnsOf(asOwner)).filter((c) => c.stateType === 'started');
      expect(started.map((c) => c.id)).toContain(todo.id);
    });

    it('returns 404 for a missing column', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: '00000000-0000-4000-8000-000000000000' })
        .patch({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .patch({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown state type', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .patch({ stateType: 'nonsense' as unknown as 'started' });
      expect(res.status).toBe(400);
    });
  });

  describe('delete', () => {
    it("moves the column's issues to the target, then drops the column", async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const inProgress = await columnByName(asOwner, 'In Progress');
      const issue = (await createIssue(asOwner, todo.id)).data!;

      const del = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'move', targetStateId: inProgress.id });
      expect(del.status).toBe(204);

      // Column gone from the view; the issue survived, now in the target column.
      const cols = await columnsOf(asOwner);
      expect(cols.map((c) => c.id)).not.toContain(todo.id);
      const moved = await asOwner.issues({ issueId: issue.id }).get();
      expect(moved.data?.stateId).toBe(inProgress.id);
    });

    it('logs the reassignment as a status change on every moved issue', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const inProgress = await columnByName(asOwner, 'In Progress');
      const issue = (await createIssue(asOwner, todo.id)).data!;

      await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'move', targetStateId: inProgress.id });

      // Without the entry the timeline would keep the issue in the deleted column.
      const timeline = await asOwner.issues({ issueId: issue.id }).timeline.get();
      expect(timeline.data!.map((s) => s.status)).toEqual(['Todo', 'In Progress']);
      const opened = await asOwner
        .issues({ issueId: issue.id })
        .timeline.items.get({ query: { from: timeline.data![1]!.from } });
      expect(opened.data!.some((i) => i.action === 'status')).toBe(true);
    });

    it('removes the column and its issues in delete mode', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const issue = (await createIssue(asOwner, todo.id)).data!;

      const del = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'delete' });
      expect(del.status).toBe(204);

      const cols = await columnsOf(asOwner);
      expect(cols.map((c) => c.id)).not.toContain(todo.id);
      const gone = await asOwner.issues({ issueId: issue.id }).get();
      expect(gone.status).toBe(404);
    });

    it('rejects deleting a backlog column', async () => {
      const { asOwner } = await setupTeam();
      const backlog = await columnByName(asOwner, 'Backlog');
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: backlog.id })
        .delete({ mode: 'delete' });
      expect(res.status).toBe(400);
    });

    it('rejects a move whose target is in another team', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = (await columnsOf(asOwner, 'OPS'))[0];

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'move', targetStateId: foreign.id });
      expect(res.status).toBe(400);
    });

    it('rejects a move whose target is the column itself', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'move', targetStateId: todo.id });
      expect(res.status).toBe(400);
    });

    it('returns 404 for a missing column', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: '00000000-0000-4000-8000-000000000000' })
        .delete({ mode: 'delete' });
      expect(res.status).toBe(404);
    });

    it('rejects an invalid delete body', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      // mode "move" without a targetStateId does not match either union branch.
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: todo.id })
        .delete({ mode: 'move' } as unknown as { mode: 'delete' });
      expect(res.status).toBe(400);
    });
  });

  // A column is addressed as /teams/:teamKey/columns/:stateId. The
  // permission guard runs on :teamKey, so the store must also scope the column
  // to that team — otherwise a member of one team could edit or delete a
  // column of another team by passing its id.
  describe('description', () => {
    it('stores a description on create and update', async () => {
      const { asOwner } = await setupTeam();
      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        .states.post({ name: 'Review', stateType: 'started', description: 'Waiting on review' });
      expect(created.data).toMatchObject({ description: 'Waiting on review' });
      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: created.data!.id })
        .patch({ description: 'Code review' });
      expect(patched.data).toMatchObject({ description: 'Code review' });
    });
  });

  describe('archive', () => {
    async function addColumn(client: Api, name: string, stateType: 'started' | 'completed') {
      const res = await client.teams({ teamKey: 'MKT' }).states.post({ name, stateType });
      return res.data!;
    }

    it('archives an empty column and hides it from the team', async () => {
      const { asOwner } = await setupTeam();
      const review = await addColumn(asOwner, 'Review', 'started');
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: review.id })
        .archive.post();
      expect(res.status).toBe(200);
      expect(res.data!.archivedAt).toBeTruthy();
      expect((await columnsOf(asOwner)).map((c) => c.id)).not.toContain(review.id);
    });

    it('refuses to archive a column that still has issues', async () => {
      const { asOwner } = await setupTeam();
      const review = await addColumn(asOwner, 'Review', 'started');
      await createIssue(asOwner, review.id);
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: review.id })
        .archive.post();
      expect(res.status).toBe(409);
    });

    it('refuses to archive the last column of its type', async () => {
      const { asOwner } = await setupTeam();
      const done = (await columnsOf(asOwner)).find((c) => c.stateType === 'completed')!;
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: done.id })
        .archive.post();
      expect(res.status).toBe(409);
    });

    it('refuses an archived column as an issue target', async () => {
      const { asOwner } = await setupTeam();
      const review = await addColumn(asOwner, 'Review', 'started');
      await asOwner.teams({ teamKey: 'MKT' }).states({ stateId: review.id }).archive.post();

      expect((await createIssue(asOwner, review.id)).status).toBe(400);
      const todo = await columnByName(asOwner, 'Todo');
      const issue = (await createIssue(asOwner, todo.id)).data!;
      const moved = await asOwner.issues({ issueId: issue.id }).patch({ stateId: review.id });
      expect(moved.status).toBe(400);
    });

    it('restores an archived issue of an archived column into an active column of the same type', async () => {
      const { asOwner } = await setupTeam();
      const review = await addColumn(asOwner, 'Review', 'started');
      const issue = (await createIssue(asOwner, review.id)).data!;
      await asOwner.issues({ issueId: issue.id }).archive.post();
      await asOwner.teams({ teamKey: 'MKT' }).states({ stateId: review.id }).archive.post();

      await asOwner.issues({ issueId: issue.id }).restore.post();
      const restored = await asOwner.issues({ issueId: issue.id }).get();
      const active = await columnsOf(asOwner);
      const target = active.find((c) => c.id === restored.data!.stateId);
      expect(target?.stateType).toBe('started');
    });

    it('denies a non-member', async () => {
      const { asOwner } = await setupTeam();
      const review = await addColumn(asOwner, 'Review', 'started');
      const outsider = (await signUpWithRole('guest')).api;
      const res = await outsider
        .teams({ teamKey: 'MKT' })
        .states({ stateId: review.id })
        .archive.post();
      expect(res.status).toBe(404);
    });
  });

  describe('cross-team isolation', () => {
    it('does not patch a column that belongs to another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = await columnByName(asOwner, 'Todo', 'OPS');

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: foreign.id })
        .patch({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const opsTodo = await columnByName(asOwner, 'Todo', 'OPS');
      expect(opsTodo.name).toBe('Todo');
    });

    it('does not delete a column that belongs to another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = await columnByName(asOwner, 'Todo', 'OPS');

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .states({ stateId: foreign.id })
        .delete({ mode: 'delete' });
      expect(res.status).toBe(404);

      const opsCols = await columnsOf(asOwner, 'OPS');
      expect(opsCols.map((c) => c.id)).toContain(foreign.id);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'NOPE' })
        .states.post({ name: 'X', stateType: 'started' });
      expect(res.status).toBe(404);
    });

    it('denies a non-member on every column route', async () => {
      const { asOwner } = await setupTeam();
      const todo = await columnByName(asOwner, 'Todo');
      const outsider = authedApi((await signUpTestUser()).cookie);
      const scope = outsider.teams({ teamKey: 'MKT' });

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect((await scope.states.post({ name: 'X', stateType: 'started' })).status).toBe(403);
      expect((await scope.states.reorder.put({ orderedIds: [todo.id] })).status).toBe(403);
      expect((await scope.states({ stateId: todo.id }).patch({ name: 'X' })).status).toBe(403);
      expect((await scope.states({ stateId: todo.id }).delete({ mode: 'delete' })).status).toBe(
        403,
      );
    });
  });
});
