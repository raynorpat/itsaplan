import { beforeEach, describe, expect, it } from 'bun:test';
import {
  attachment,
  comment,
  db,
  issue,
  issueActivity,
  issueLabel,
  label,
  userEmail,
  webhookDelivery,
} from '@repo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createTeam,
  createWebhook,
  gqlData,
  signUpAs,
  statesByType,
} from '../../../__tests__/helpers/graphql';
import { memberEmails } from '../../../accounts/emails';
import { createLabel } from '../../../labels/store';
import { processImport, suggestPeople } from '../../engine';
import { createImport, getImport, setImportStatus, sweepInterruptedImports } from '../../store';
import type { SourceData, SourceIssue, SourcePerson } from '../../types';

// The import engine turns normalised source data and a people mapping into issues,
// labels, comments and link attachments of the destination team, as a system change.

const octo: SourcePerson = { key: 'octo', login: 'octo', name: 'Octo Cat', email: null };
const ann: SourcePerson = { key: 'ann', login: 'ann-gh', name: 'Ann', email: 'ann@x.dev' };
const stranger: SourcePerson = { key: 'zed', login: 'zed', name: 'Zed', email: null };
const outsider: SourcePerson = { key: 'out', login: 'out', name: 'Out', email: null };

function sourceIssue(n: number, extra: Partial<SourceIssue> = {}): SourceIssue {
  return {
    url: `https://github.com/acme/app/issues/${n}`,
    number: n,
    title: `Issue ${n}`,
    body: `Body ${n}`,
    state: 'open',
    labels: [],
    author: octo,
    assignee: null,
    createdAt: '2024-01-0' + Math.min(n, 9) + 'T10:00:00Z',
    closedAt: null,
    comments: [],
    ...extra,
  };
}

const data = (issues: SourceIssue[]): SourceData => ({ serviceLabel: 'GitHub', issues });

let owner: TestUser;
let member: TestUser;
let other: TestUser;
let teamId: string;
let states: Record<string, string>;

async function newImport(): Promise<string> {
  const row = await createImport({
    service: 'github',
    teamId,
    creatorId: owner.userId,
    displayName: 'acme/app',
    serviceMetadata: { repository: 'acme/app' },
  });
  return row.id;
}

async function teamIssues() {
  return db.select().from(issue).where(eq(issue.teamId, teamId)).orderBy(asc(issue.createdAt));
}

async function linkOf(issueId: string) {
  return db.select().from(attachment).where(eq(attachment.issueId, issueId));
}

beforeEach(async () => {
  await resetDb();
  owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  teamId = eng.team.id;
  states = statesByType(eng);
  member = await signUpAs('member', { name: 'Ann Member' });
  await addMember(owner, teamId, member.userId);
  // A workspace member who is not in the team.
  other = await signUpAs('member', { name: 'Other' });
});

describe('processImport', () => {
  it('creates issues, labels, comments and links as the source describes', async () => {
    await createLabel({ teamId, name: 'Bug', actorUserId: owner.userId });
    await createWebhook(owner, {
      url: 'https://hooks.example.com/in',
      resourceTypes: ['Issue', 'Comment', 'Attachment', 'IssueLabel'],
      teamId,
    });
    const id = await newImport();
    const summary = await processImport(
      id,
      data([
        sourceIssue(1, {
          labels: [
            { name: 'bug', color: 'd73a4a' },
            { name: 'Feature', color: '#ABC' },
          ],
          author: ann,
          assignee: ann,
          comments: [
            { author: octo, body: 'First', createdAt: '2024-01-02T10:00:00Z' },
            { author: ann, body: 'Second', createdAt: '2024-01-03T10:00:00Z' },
          ],
        }),
        sourceIssue(2, { state: 'closed', closedAt: '2024-02-01T10:00:00Z', assignee: stranger }),
        sourceIssue(3, {
          state: 'notPlanned',
          closedAt: '2024-02-02T10:00:00Z',
          assignee: outsider,
        }),
      ]),
      { ann: member.userId, octo: null, zed: null, out: other.userId },
    );

    expect(summary).toMatchObject({
      issues: 3,
      skippedExisting: 0,
      comments: 2,
      labelsCreated: 1,
      total: 3,
    });
    const rows = await teamIssues();
    expect(rows.map((r) => r.title)).toEqual(['Issue 1', 'Issue 2', 'Issue 3']);
    const [one, two, three] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];

    // States: open → first unstarted, closed → first completed, not planned → canceled.
    expect(one.stateId).toBe(states.unstarted!);
    expect(two.stateId).toBe(states.completed!);
    expect(two.completedAt?.toISOString()).toBe('2024-02-01T10:00:00.000Z');
    expect(three.stateId).toBe(states.canceled!);
    expect(three.canceledAt?.toISOString()).toBe('2024-02-02T10:00:00.000Z');

    // Original dates.
    expect(one.createdAt.toISOString()).toBe('2024-01-01T10:00:00.000Z');

    // People: a mapped team member is assignee and creator; unmapped → unassigned and
    // the importer is the creator; a mapping to someone outside the team is dropped.
    expect(one.assigneeUserId).toBe(member.userId);
    expect(one.creatorUserId).toBe(member.userId);
    expect(two.assigneeUserId).toBeNull();
    expect(two.creatorUserId).toBe(owner.userId);
    expect(three.assigneeUserId).toBeNull();

    // Labels: matched by name ignoring case, missing ones created with a normalised colour.
    const labels = await db
      .select({ name: label.name, color: label.color })
      .from(issueLabel)
      .innerJoin(label, eq(label.id, issueLabel.labelId))
      .where(eq(issueLabel.issueId, one.id));
    expect(labels.map((l) => l.name).sort()).toEqual(['Bug', 'Feature']);
    expect(labels.find((l) => l.name === 'Feature')!.color).toBe('#aabbcc');

    // Comments in order, with the source author's name and their dates.
    const comments = await db
      .select()
      .from(comment)
      .where(eq(comment.issueId, one.id))
      .orderBy(asc(comment.createdAt));
    expect(comments.map((c) => c.body)).toEqual([
      '**Octo Cat** on GitHub wrote:\n\nFirst',
      '**Ann** on GitHub wrote:\n\nSecond',
    ]);
    expect(comments[0]!.createdAt.toISOString()).toBe('2024-01-02T10:00:00.000Z');

    // A link back to the source issue.
    const [link] = await linkOf(one.id);
    expect(link).toMatchObject({
      url: 'https://github.com/acme/app/issues/1',
      title: 'GitHub #1',
    });

    // A system change: no webhook delivery.
    expect(await db.select().from(webhookDelivery)).toEqual([]);

    const job = (await getImport(id))!;
    expect(job.status).toBe('complete');
    expect(job.progress).toBe(100);
  });

  it('skips issues already imported into the team', async () => {
    await processImport(await newImport(), data([sourceIssue(1), sourceIssue(2)]), {});
    const summary = await processImport(
      await newImport(),
      data([sourceIssue(1), sourceIssue(2), sourceIssue(3)]),
      {},
    );
    expect(summary).toMatchObject({ issues: 1, skippedExisting: 2 });
    expect((await teamIssues()).map((r) => r.title)).toEqual(['Issue 1', 'Issue 2', 'Issue 3']);
  });

  it('leaves each issue and its comments once after an interrupted run', async () => {
    const withComment = (n: number) =>
      sourceIssue(n, {
        comments: [{ author: octo, body: `c${n}`, createdAt: '2024-01-05T10:00:00Z' }],
      });
    await processImport(await newImport(), data([withComment(1), withComment(2)]), {});
    // A run stopped while the second issue was half written: its link not yet marked
    // complete and its comments not yet added.
    const [, second] = await teamIssues();
    await db.delete(comment).where(eq(comment.issueId, second!.id));
    await db
      .update(attachment)
      .set({ metadata: { imported: false } })
      .where(eq(attachment.issueId, second!.id));

    await processImport(await newImport(), data([withComment(1), withComment(2)]), {});
    const rows = await teamIssues();
    expect(rows.map((r) => r.title)).toEqual(['Issue 1', 'Issue 2']);
    const comments = await db
      .select({ body: comment.body })
      .from(comment)
      .where(
        inArray(
          comment.issueId,
          rows.map((r) => r.id),
        ),
      );
    expect(comments.map((c) => c.body).sort()).toEqual([
      '**Octo Cat** on GitHub wrote:\n\nc1',
      '**Octo Cat** on GitHub wrote:\n\nc2',
    ]);
  });

  it('imports a source issue listed twice once', async () => {
    const summary = await processImport(
      await newImport(),
      data([sourceIssue(1), sourceIssue(2), sourceIssue(1)]),
      {},
    );
    expect((await teamIssues()).map((r) => r.title)).toEqual(['Issue 1', 'Issue 2']);
    expect(summary).toMatchObject({ issues: 2, skippedExisting: 1 });
  });

  it('leaves an issue unassigned when its matched member is suspended', async () => {
    await gqlData(owner, 'mutation($id: String!) { userSuspend(id: $id) { success } }', {
      id: member.userId,
    });
    const summary = await processImport(
      await newImport(),
      data([sourceIssue(1, { assignee: ann, author: ann })]),
      { ann: member.userId },
    );
    expect(summary).toMatchObject({ issues: 1, skipped: [] });
    const [row] = await teamIssues();
    expect(row!.assigneeUserId).toBeNull();
  });

  it('truncates long titles and keeps the full title in the body', async () => {
    const long = 'x'.repeat(300);
    await processImport(await newImport(), data([sourceIssue(1, { title: long, body: '' })]), {});
    const [row] = await teamIssues();
    expect(row!.title.length).toBe(255);
    expect(row!.description.startsWith(long)).toBe(true);
  });

  it('creates the team named by the import', async () => {
    const row = await createImport({
      service: 'gitea',
      teamName: 'Imported Repo',
      creatorId: owner.userId,
      displayName: 'acme/repo',
      serviceMetadata: { repository: 'acme/repo' },
    });
    await processImport(row.id, { serviceLabel: 'Gitea', issues: [sourceIssue(1)] }, {});
    const job = (await getImport(row.id))!;
    expect(job.teamId).not.toBeNull();
    const created = await db.select().from(issue).where(eq(issue.teamId, job.teamId!));
    expect(created).toHaveLength(1);
  });

  it('adds the matched members to a team it creates, so they keep their issues', async () => {
    const row = await createImport({
      service: 'gitea',
      teamName: 'Imported Two',
      creatorId: owner.userId,
      displayName: 'acme/two',
      serviceMetadata: { repository: 'acme/two' },
    });
    await processImport(
      row.id,
      { serviceLabel: 'Gitea', issues: [sourceIssue(1, { author: ann, assignee: ann })] },
      { ann: other.userId, octo: null },
    );
    const job = (await getImport(row.id))!;
    const [created] = await db.select().from(issue).where(eq(issue.teamId, job.teamId!));
    expect(created!.assigneeUserId).toBe(other.userId);
    expect(created!.creatorUserId).toBe(other.userId);
  });

  it('links the created issue to its import in history', async () => {
    const id = await newImport();
    await processImport(id, data([sourceIssue(1)]), {});
    const [row] = await teamIssues();
    const [created] = await db
      .select()
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, row!.id), eq(issueActivity.action, 'created')));
    expect(created!.issueImportId).toBe(id);
    const res = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { history { nodes {
        issueImport { id service status displayName } } } } }`,
      { id: row!.id },
    );
    const nodes = res.issue.history.nodes as { issueImport: Record<string, unknown> | null }[];
    expect(nodes.find((n) => n.issueImport)?.issueImport).toEqual({
      id,
      service: 'github',
      status: 'complete',
      displayName: 'acme/app',
    });
  });

  it("shows an import's error, mapping and server address to admins only", async () => {
    const id = await createImport({
      service: 'gitea',
      teamId,
      creatorId: owner.userId,
      displayName: 'acme/app',
      serviceMetadata: { host: 'http://git.internal:3000', repository: 'acme/app' },
    }).then((r) => r.id);
    await processImport(id, data([sourceIssue(1, { assignee: ann })]), { ann: member.userId });
    await setImportStatus(id, 'error', { error: 'The server answered 500: internal detail' });
    const [row] = await teamIssues();
    const read = async (as: TestUser) => {
      const res = await gqlData(
        as,
        `query ($id: String!) { issue(id: $id) { history { nodes {
          issueImport { error mapping serviceMetadata } } } } }`,
        { id: row!.id },
      );
      const nodes = res.issue.history.nodes as { issueImport: Record<string, unknown> | null }[];
      return nodes.find((n) => n.issueImport)!.issueImport!;
    };
    expect(await read(owner)).toMatchObject({
      error: 'The server answered 500: internal detail',
      mapping: { people: { ann: member.userId } },
      serviceMetadata: { host: 'http://git.internal:3000' },
    });
    expect(await read(member)).toEqual({
      error: null,
      mapping: null,
      serviceMetadata: { repository: 'acme/app' },
    });
  });
});

describe('sweepInterruptedImports', () => {
  it('ends imports left running as interrupted', async () => {
    const running = await newImport();
    await setImportStatus(running, 'inProcess');
    const fetching = await newImport();
    await setImportStatus(fetching, 'inProgress');
    const done = await newImport();
    await setImportStatus(done, 'complete');
    await sweepInterruptedImports();
    expect((await getImport(running))!).toMatchObject({
      status: 'error',
      error: 'Interrupted, run the import again',
    });
    expect((await getImport(fetching))!.status).toBe('error');
    expect((await getImport(done))!.status).toBe('complete');
  });
});

describe('suggestPeople', () => {
  it('matches by sign-in email, confirmed extra email, then exact name or login', async () => {
    await db.insert(userEmail).values({
      userId: other.userId,
      email: 'other@old.dev',
      verifiedAt: new Date(),
    });
    await db.insert(userEmail).values({ userId: owner.userId, email: 'pending@x.dev' });
    const ids = [owner.userId, member.userId, other.userId];
    const emails = await memberEmails(ids);
    const members = [
      { id: owner.userId, emails: emails.get(owner.userId) ?? [], name: 'Owner' },
      { id: member.userId, emails: emails.get(member.userId) ?? [], name: 'Ann Member' },
      { id: other.userId, emails: emails.get(other.userId) ?? [], name: 'Other' },
    ];
    const memberEmail = emails.get(member.userId)![0]!;
    const people: SourcePerson[] = [
      { key: 'a', login: 'a', name: null, email: memberEmail.toUpperCase() },
      { key: 'b', login: 'b', name: null, email: 'other@old.dev' },
      { key: 'c', login: 'owner', name: null, email: null },
      { key: 'd', login: 'd', name: 'ann member', email: null },
      { key: 'e', login: 'e', name: null, email: 'pending@x.dev' },
      { key: 'f', login: 'f', name: 'Nobody', email: null },
    ];
    expect(suggestPeople(people, members)).toEqual({
      a: member.userId,
      b: other.userId,
      c: owner.userId,
      d: member.userId,
      e: null,
      f: null,
    });
  });
});
