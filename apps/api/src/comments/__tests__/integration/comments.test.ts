import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { claimDueRuns } from '../../../ai-agents/run-queue';

// Comments are stored in their own table; the issue, range, share and project
// feeds merge them with the change log.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const issue = (
    await asOwner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId: team.states[0].id, title: 'Task' })
  ).data!;
  return { owner, asOwner, team, issue };
}

describe('comments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('posts a comment that the feed returns with editedAt null and parentId null', async () => {
    const { asOwner, issue } = await setup();
    const res = await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'hi' });
    expect(res.data).toMatchObject({ kind: 'comment', body: 'hi', editedAt: null, parentId: null });
    const feed = await asOwner.issues({ issueId: issue.id }).feed.get();
    expect(feed.data!.items.find((i) => i.kind === 'comment')).toMatchObject({
      body: 'hi',
      editedAt: null,
      parentId: null,
    });
  });

  it('merges comments and change-log entries newest first and pages without loss', async () => {
    const { asOwner, issue } = await setup();
    for (let i = 0; i < 3; i++) {
      await asOwner.issues({ issueId: issue.id }).comments.post({ body: `c${i}` });
      await asOwner.issues({ issueId: issue.id }).patch({ title: `t${i}` });
    }
    const seen: { id: string; createdAt: unknown; kind: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await asOwner
        .issues({ issueId: issue.id })
        .feed.get({ query: { limit: 2, ...(cursor ? { cursor } : {}) } });
      seen.push(...page.data!.items);
      if (!page.data!.nextCursor) break;
      cursor = JSON.stringify(page.data!.nextCursor);
    }
    expect(new Set(seen.map((s) => s.id)).size).toBe(seen.length);
    expect(seen.filter((s) => s.kind === 'comment')).toHaveLength(3);
    expect(seen.filter((s) => s.kind === 'activity').length).toBeGreaterThanOrEqual(4);
    const times = seen.map((s) => new Date(s.createdAt as string).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('includes comments in the timeline range', async () => {
    const { asOwner, issue } = await setup();
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'in range' });
    const res = await asOwner
      .issues({ issueId: issue.id })
      .timeline.items.get({ query: { from: new Date(0).toISOString() } });
    expect(res.data!.some((i) => i.kind === 'comment' && i.body === 'in range')).toBe(true);
  });

  it("lists an issue's comments in its project's feed", async () => {
    const { asOwner, team, issue } = await setup();
    const project = (await asOwner.projects.post({ name: 'P', teamIds: [team.team.id] })).data!;
    await asOwner.issues({ issueId: issue.id }).patch({ projectId: project.id });
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'linked' });
    const feed = await asOwner.projects({ projectId: project.id }).feed.get();
    expect(feed.data!.items.some((i) => i.kind === 'comment' && i.body === 'linked')).toBe(true);
  });

  it("names the comment's author as the requester of an agent mention run", async () => {
    const { owner, asOwner, issue } = await setup();
    const agent = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        ['ai-agents'].post({ name: 'Helper', username: 'helper', kind: 'internal' })
    ).data!.agent;
    await asOwner
      .issues({ issueId: issue.id })
      .comments.post({ body: `hey @[Helper](user:${agent.userId})` });
    const runs = await claimDueRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ requesterUserId: owner.userId, requesterName: 'Owner' });
  });
});
