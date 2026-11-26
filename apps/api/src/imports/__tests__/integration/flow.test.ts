import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, issue } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { addMember, createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { beginFetch, expireWaitingImports, isAwaitingPeople, startProcessing } from '../../flow';
import { getJson } from '../../sources/http';
import { createImport, getImport, type ImportRow } from '../../store';
import type { SourceData, SourceIssue, SourcePerson } from '../../types';

// The steps every import shares (flow.ts): the background fetch, the people matching
// while the fetched data waits, and the start of processing.

const ann: SourcePerson = { key: 'ann', login: 'ann', name: 'Ann', email: null };

const sourceIssue = (n: number, extra: Partial<SourceIssue> = {}): SourceIssue => ({
  url: `https://git.example/acme/app/issues/${n}`,
  number: n,
  title: `Issue ${n}`,
  body: '',
  state: 'open',
  labels: [],
  author: ann,
  assignee: ann,
  createdAt: '2024-01-01T10:00:00Z',
  closedAt: null,
  comments: [],
  ...extra,
});

const data = (n = 3): SourceData => ({
  serviceLabel: 'Gitea',
  issues: Array.from({ length: n }, (_, k) => sourceIssue(k + 1)),
});

let limitedOnce = true;
const server = Bun.serve({
  port: 0,
  fetch() {
    if (limitedOnce) {
      limitedOnce = false;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
    }
    return Response.json({ ok: true });
  },
});
afterAll(() => server.stop(true));

let owner: TestUser;
let teamId: string;

async function waitFor(id: string, done: (row: ImportRow) => boolean): Promise<ImportRow> {
  for (let i = 0; i < 200; i += 1) {
    const row = (await getImport(id))!;
    if (done(row)) return row;
    await Bun.sleep(20);
  }
  throw new Error('The import did not reach the expected state');
}

// An import fetched and waiting for the people matching.
async function fetched(source: SourceData = data()): Promise<ImportRow> {
  const row = await createImport({
    service: 'gitea',
    teamId,
    creatorId: owner.userId,
    displayName: 'acme/app',
    serviceMetadata: { repository: 'acme/app' },
  });
  beginFetch(row, async () => source);
  return waitFor(row.id, (r) => isAwaitingPeople(r));
}

const teamIssues = () => db.select().from(issue).where(eq(issue.teamId, teamId));

beforeEach(async () => {
  await resetDb();
  owner = await signUpTestUser({ name: 'Owner' });
  teamId = (await createTeam(owner, { key: 'ENG', name: 'Engineering' })).team.id;
});

describe('import flow', () => {
  it('starts processing once when asked twice at the same time', async () => {
    const row = await fetched();
    const results = await Promise.allSettled([
      startProcessing(row, { ann: null }),
      startProcessing(row, { ann: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await waitFor(row.id, (r) => r.status === 'complete');
    expect(await teamIssues()).toHaveLength(3);
  });

  it('runs one import at a time into a team', async () => {
    const first = await fetched(data(40));
    const second = await fetched(data(40));
    const results = await Promise.allSettled([
      startProcessing(first, { ann: null }),
      startProcessing(second, { ann: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toMatch(/another import/i);
    const winner = results[0]!.status === 'fulfilled' ? first : second;
    await waitFor(winner.id, (r) => r.status === 'complete');
    expect(await teamIssues()).toHaveLength(40);
  });

  it('keeps a matched team member as the assignee', async () => {
    const member = await signUpAs('member', { name: 'Member' });
    await addMember(owner, teamId, member.userId);
    const row = await fetched(data(1));
    await startProcessing(row, { ann: member.userId });
    await waitFor(row.id, (r) => r.status === 'complete');
    expect((await teamIssues())[0]!.assigneeUserId).toBe(member.userId);
  });

  it('adds only people who may be chosen to a team the import creates', async () => {
    const active = await signUpAs('member', { name: 'Active' });
    const suspended = await signUpAs('member', { name: 'Suspended' });
    const suspend = (action: 'userSuspend' | 'userUnsuspend') =>
      gqlData(owner, `mutation($id: String!) { ${action}(id: $id) { success } }`, {
        id: suspended.userId,
      });
    await suspend('userSuspend');
    const bob: SourcePerson = { key: 'bob', login: 'bob', name: 'Bob', email: null };
    const created = await createImport({
      service: 'gitea',
      teamName: 'Imported',
      creatorId: owner.userId,
      displayName: 'acme/app',
      serviceMetadata: { repository: 'acme/app' },
    });
    beginFetch(created, async () => ({
      serviceLabel: 'Gitea',
      issues: [sourceIssue(1), sourceIssue(2, { author: bob, assignee: bob })],
    }));
    const row = await waitFor(created.id, (r) => isAwaitingPeople(r));
    await startProcessing(row, { ann: suspended.userId, bob: active.userId });
    const done = await waitFor(row.id, (r) => r.status === 'complete');
    await suspend('userUnsuspend');
    const team = await gqlData(
      owner,
      `query($id: String!) { team(id: $id) { members { nodes { id } } } }`,
      {
        id: done.teamId,
      },
    );
    const memberIds = (team.team.members.nodes as { id: string }[]).map((n) => n.id);
    expect(memberIds).toContain(active.userId);
    expect(memberIds).not.toContain(suspended.userId);
  });

  it('expires fetched data that waits too long for the people matching', async () => {
    const row = await fetched();
    await expireWaitingImports(new Date(Date.now() + 25 * 3_600_000));
    const expired = (await getImport(row.id))!;
    expect(expired.status).toBe('error');
    expect(expired.error).toBe('Expired, run the import again');
    expect(isAwaitingPeople(expired)).toBe(false);
    await expect(startProcessing(expired, {})).rejects.toThrow(/not waiting/i);
  });

  it('keeps fetched data that has waited less than a day', async () => {
    const row = await fetched();
    await expireWaitingImports(new Date(Date.now() + 23 * 3_600_000));
    expect(isAwaitingPeople((await getImport(row.id))!)).toBe(true);
  });

  it('shows until when a fetch waits for the source rate limit', async () => {
    const row = await createImport({
      service: 'gitea',
      teamId,
      creatorId: owner.userId,
      displayName: 'acme/app',
      serviceMetadata: { repository: 'acme/app' },
    });
    beginFetch(row, async () => {
      await getJson(`http://localhost:${server.port}/`, {}, '');
      return data(1);
    });
    const waiting = await waitFor(
      row.id,
      (r) => typeof (r.serviceMetadata as Record<string, unknown>).waitingUntil === 'string',
    );
    expect(
      Date.parse((waiting.serviceMetadata as Record<string, string>).waitingUntil!),
    ).toBeGreaterThan(Date.now() - 2000);
    const done = await waitFor(row.id, (r) => isAwaitingPeople(r));
    expect((done.serviceMetadata as Record<string, unknown>).waitingUntil).toBeUndefined();
    expect((done.serviceMetadata as Record<string, unknown>).repository).toBe('acme/app');
  });
});
