import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// An issue's timeline (issue_activity): comments (POST /issues/:issueId/comments)
// and change-log entries recorded by the issue mutation routes, merged and paged
// newest first by GET /issues/:issueId/feed. Both routes resolve access through
// the workItem guard on the issue. Change-log entries are asserted through the
// feed — that is the observable output of an update.

interface Setup {
  asOwner: Api;
  owner: TestUser;
  stateId: string;
  stateIds: string[];
}

async function setupTeam(): Promise<Setup> {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  const stateIds = view.data!.states.map((c) => c.id);
  return { asOwner, owner, stateId: stateIds[0], stateIds };
}

function createIssue(client: Api, stateId: string, patch: Record<string, unknown> = {}) {
  return client.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task', ...patch });
}

// One page of the feed (newest first).
async function feed(client: Api, issueId: string, query: Record<string, string> = {}) {
  const res = await client.issues({ issueId }).feed.get({ query });
  return res;
}

describe('issue activity', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('comments', () => {
    it('adds a comment and returns it', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'looks good' });
      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({ kind: 'comment', body: 'looks good', issueId: issue.id });
    });

    it('records the author from the session user', async () => {
      const { asOwner, owner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'mine' });
      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({ actorUserId: owner.userId, actorName: 'Owner' });
    });

    it('shows the comment in the feed', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'first note' });

      const res = await feed(asOwner, issue.id);
      expect(res.status).toBe(200);
      const comment = res.data?.items.find((i) => i.kind === 'comment');
      expect(comment?.body).toBe('first note');
    });

    it('rejects an empty comment body', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const res = await asOwner.issues({ issueId: issue.id }).comments.post({ body: '' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when commenting on a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .issues({ issueId: '00000000-0000-4000-8000-000000000000' })
        .comments.post({ body: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('feed', () => {
    it("records a 'created' entry when an issue is created", async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await feed(asOwner, issue.id);
      expect(res.status).toBe(200);
      expect(res.data?.items.some((i) => i.kind === 'activity' && i.action === 'created')).toBe(
        true,
      );
    });

    it('returns items newest first', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'one' });
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'two' });

      const res = await feed(asOwner, issue.id);
      const comments = res.data!.items.filter((i) => i.kind === 'comment');
      expect(comments.map((c) => c.body)).toEqual(['two', 'one']);
    });

    it('pages through the feed with limit and cursor', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      for (const body of ['a', 'b', 'c']) {
        await asOwner.issues({ issueId: issue.id }).comments.post({ body });
      }

      const first = await feed(asOwner, issue.id, { limit: '2' });
      expect(first.data?.items.length).toBe(2);
      expect(first.data?.nextCursor).not.toBeNull();

      const second = await feed(asOwner, issue.id, {
        limit: '2',
        cursor: JSON.stringify(first.data!.nextCursor),
      });
      // No overlap between the two pages.
      const firstIds = first.data!.items.map((i) => i.id);
      const secondIds = second.data!.items.map((i) => i.id);
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });

    it('serves the first page for a malformed cursor', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'note' });

      const res = await feed(asOwner, issue.id, { cursor: 'not-json' });
      expect(res.status).toBe(200);
      expect(res.data?.items.some((i) => i.kind === 'comment')).toBe(true);
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      const res = await feed(asOwner, '00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  // Change-log entries are written by the issue mutation routes and read back
  // through the feed. Assert the action and its from/to text.
  describe('change log', () => {
    async function actions(client: Api, issueId: string) {
      const res = await feed(client, issueId, { limit: '100' });
      return res.data!.items.filter((i) => i.kind === 'activity');
    }

    it('logs a title change with its old and new value', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId, { title: 'Old' })).data!;
      await asOwner.issues({ issueId: issue.id }).patch({ title: 'New' });

      const title = (await actions(asOwner, issue.id)).find((a) => a.action === 'title');
      expect(title).toMatchObject({ fromText: 'Old', toText: 'New' });
    });

    it('logs a column move as a status change with column names', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).patch({ stateId: stateIds[1] });

      const status = (await actions(asOwner, issue.id)).find((a) => a.action === 'status');
      expect(status).toBeDefined();
      expect(status?.fromText).not.toBeNull();
      expect(status?.toText).not.toBeNull();
      expect(status?.fromText).not.toBe(status?.toText);
    });

    it('logs added and removed labels', async () => {
      const { asOwner, stateId } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'bug' })).data!;
      const issue = (await createIssue(asOwner, stateId)).data!;

      await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [label.id] });
      const added = (await actions(asOwner, issue.id)).find((a) => a.action === 'label_add');
      expect(added?.toText).toBe('bug');

      await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [] });
      const removed = (await actions(asOwner, issue.id)).find((a) => a.action === 'label_remove');
      expect(removed?.fromText).toBe('bug');
    });

    it("does not log the name of another team's label", async () => {
      const { asOwner, stateId } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = (await asOwner.teams({ teamKey: 'OPS' }).labels.post({ name: 'ops-secret' }))
        .data!;
      const issue = (await createIssue(asOwner, stateId)).data!;

      const patched = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [foreign.id] });
      expect(patched.status).toBe(400);
      expect((await actions(asOwner, issue.id)).some((a) => a.action === 'label_add')).toBe(false);
    });

    it('does not log a position-only reorder', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const before = (await actions(asOwner, issue.id)).length;

      await asOwner.issues({ issueId: issue.id }).patch({ position: 42 });
      const after = await actions(asOwner, issue.id);
      expect(after.length).toBe(before);
    });
  });

  // The stretches the issue spent in one column, oldest first and without their
  // entries (GET /issues/:issueId/timeline).
  describe('timeline', () => {
    async function timeline(client: Api, issueId: string) {
      return client.issues({ issueId }).timeline.get();
    }

    it('returns one open segment for an issue that never moved', async () => {
      const { asOwner, stateId } = await setupTeam();
      const view = await asOwner.teams({ teamKey: 'MKT' }).get();
      const columnName = view.data!.states.find((c) => c.id === stateId)!.name;
      const issue = (await createIssue(asOwner, stateId)).data!;

      const res = await timeline(asOwner, issue.id);
      expect(res.status).toBe(200);
      expect(res.data!.length).toBe(1);
      expect(res.data![0]).toMatchObject({ status: columnName, to: null });
    });

    it('splits at a status change and names both columns', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const view = await asOwner.teams({ teamKey: 'MKT' }).get();
      const names = new Map(view.data!.states.map((c) => [c.id, c.name]));
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).patch({ stateId: stateIds[1] });

      const res = await timeline(asOwner, issue.id);
      expect(res.data!.map((s) => s.status)).toEqual([
        names.get(stateId)!,
        names.get(stateIds[1])!,
      ]);
      // The first stretch is closed at the move, the second is still open.
      expect(res.data![0]!.to).not.toBeNull();
      expect(res.data![1]!.to).toBeNull();
    });

    it('repeats a status as a separate segment when the issue returns to it', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).patch({ stateId: stateIds[1] });
      await asOwner.issues({ issueId: issue.id }).patch({ stateId: stateId });

      const res = await timeline(asOwner, issue.id);
      expect(res.data!.length).toBe(3);
      expect(res.data![0]!.status).toBe(res.data![2]!.status);
    });

    it('returns 404 for a missing issue', async () => {
      const { asOwner } = await setupTeam();
      expect((await timeline(asOwner, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });
  });

  // The entries of one stretch, read when it is opened
  // (GET /issues/:issueId/timeline/items).
  describe('timeline items', () => {
    function itemsOf(client: Api, issueId: string, from: string, to?: string | null) {
      return client.issues({ issueId }).timeline.items.get({ query: to ? { from, to } : { from } });
    }

    it('serves each stretch the entries written while it was open', async () => {
      const { asOwner, stateId, stateIds } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'before the move' });
      await asOwner.issues({ issueId: issue.id }).patch({ stateId: stateIds[1] });
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'after the move' });

      const segments = (await asOwner.issues({ issueId: issue.id }).timeline.get()).data!;
      const bodies = [];
      for (const segment of segments) {
        const res = await itemsOf(asOwner, issue.id, segment.from, segment.to);
        expect(res.status).toBe(200);
        bodies.push(res.data!.filter((i) => i.kind === 'comment').map((i) => i.body));
      }
      expect(bodies).toEqual([['before the move'], ['after the move']]);

      // The move itself opens the second stretch, so it reads as "entered from X".
      const opened = (await itemsOf(asOwner, issue.id, segments[1]!.from)).data!;
      expect(opened.some((i) => i.action === 'status')).toBe(true);
      const created = (await itemsOf(asOwner, issue.id, segments[0]!.from, segments[0]!.to)).data!;
      expect(created.some((i) => i.action === 'created')).toBe(true);
    });

    it('rejects a from that is not a datetime', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;

      expect((await itemsOf(asOwner, issue.id, 'yesterday')).status).toBe(400);
    });
  });

  describe('access', () => {
    it('denies a non-member on the feed, timeline and comment routes', async () => {
      const { asOwner, stateId } = await setupTeam();
      const issue = (await createIssue(asOwner, stateId)).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect((await outsider.issues({ issueId: issue.id }).feed.get({ query: {} })).status).toBe(
        403,
      );
      expect((await outsider.issues({ issueId: issue.id }).timeline.get()).status).toBe(403);
      expect(
        (
          await outsider
            .issues({ issueId: issue.id })
            .timeline.items.get({ query: { from: new Date(0).toISOString() } })
        ).status,
      ).toBe(403);
      expect(
        (await outsider.issues({ issueId: issue.id }).comments.post({ body: 'x' })).status,
      ).toBe(403);
    });
  });
});
