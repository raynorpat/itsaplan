import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, issue, notificationDelivery } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { archiveStaleIssues } from '../../../../../worker/src/store';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import {
  addMember,
  createComment,
  createIssue,
  createProject,
  createTeam,
  gqlData,
  makePrivate,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Linear's settings over GraphQL that replace this instance's own: the team's
// auto-archive period, the workspace-wide notification categories, invite details
// without a login, the organization's approved domains, and project progress.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const as = (cookie: string) => ({ cookie });

async function setupTeam(owner: TestUser) {
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const view = await teamView(owner, 'MKT');
  const completed = view.states.find((s) => s.stateType === 'completed')!;
  const backlog = view.states[0]!;
  return { teamId: view.team.id, completedId: completed.id, backlogId: backlog.id };
}

describe('graphql settings mappings', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.EMAIL_FROM;
  });

  it('sets the auto-archive period in months and archives by it', async () => {
    const owner = await signUpTestUser();
    const { teamId, completedId } = await setupTeam(owner);
    const set = await gql(
      as(owner.cookie),
      `mutation { teamUpdate(id: "${teamId}", input: { autoArchivePeriod: 3 }) { success team { autoArchivePeriod autoClosePeriod } } }`,
    );
    expect(set.body.errors).toBeUndefined();
    expect(set.body.data).toEqual({
      teamUpdate: { success: true, team: { autoArchivePeriod: 3, autoClosePeriod: 0 } },
    });
    const odd = await gql(
      as(owner.cookie),
      `mutation { teamUpdate(id: "${teamId}", input: { autoArchivePeriod: 2 }) { success } }`,
    );
    expect(errorCode(odd)).toBe('INVALID_INPUT');
    const close = await gql(
      as(owner.cookie),
      `mutation { teamUpdate(id: "${teamId}", input: { autoClosePeriod: 1 }) { success } }`,
    );
    expect(errorCode(close)).toBe('INVALID_INPUT');

    const old = await createIssue(owner, { teamId: 'MKT', stateId: completedId, title: 'Old' });
    const recent = await createIssue(owner, {
      teamId: 'MKT',
      stateId: completedId,
      title: 'Recent',
    });
    await db
      .update(issue)
      .set({
        completedAt: sql`now() - interval '4 months'`,
        updatedAt: sql`now() - interval '4 months'`,
      })
      .where(eq(issue.id, old.id));
    await db
      .update(issue)
      .set({
        completedAt: sql`now() - interval '1 month'`,
        updatedAt: sql`now() - interval '1 month'`,
      })
      .where(eq(issue.id, recent.id));
    const archived = await archiveStaleIssues();
    expect(archived.map((a) => a.id)).toEqual([old.id]);
  });

  it('keeps email notification preferences per category for the workspace', async () => {
    const owner = await signUpTestUser();
    const { backlogId } = await setupTeam(owner);
    const member = await signUpTestUser();
    await addMember(owner, 'MKT', member.userId);
    const read = await gql(
      as(member.cookie),
      `{ userSettings { id notificationCategoryPreferences { assignments { email } mentions { email } commentsAndReplies { email } statusChanges { email } } } }`,
    );
    expect(read.body.errors).toBeUndefined();
    const settings = read.body.data!.userSettings as {
      id: string;
      notificationCategoryPreferences: Record<string, { email: boolean }>;
    };
    expect(settings.notificationCategoryPreferences).toEqual({
      assignments: { email: true },
      mentions: { email: true },
      commentsAndReplies: { email: false },
      statusChanges: { email: false },
    });
    const update = await gql(
      as(member.cookie),
      `mutation { userSettingsUpdate(id: "${settings.id}", input: { notificationCategoryPreferences: { commentsAndReplies: { email: true } } }) { success } }`,
    );
    expect(update.body.errors).toBeUndefined();
    const unsupported = await gql(
      as(member.cookie),
      `mutation { userSettingsUpdate(id: "${settings.id}", input: { subscribedToChangelog: true }) { success } }`,
    );
    expect(errorCode(unsupported)).toBe('INVALID_INPUT');

    // The member subscribes by commenting, then hears about the owner's comment.
    const created = await createIssue(owner, { teamId: 'MKT', stateId: backlogId, title: 'T' });
    await createComment(member, { issueId: created.id, body: 'first' });
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_FROM = 'Plan <plan@example.com>';
    await createComment(owner, { issueId: created.id, body: 'reply' });
    const rows = await db.select().from(notificationDelivery);
    expect(rows.map((r) => [r.channel, r.recipient])).toEqual([['email', member.email]]);
  });

  it('answers invite details by token without a login, and nothing else', async () => {
    const owner = await signUpTestUser({ name: 'Olivia' });
    const { teamId } = await setupTeam(owner);
    await makePrivate(owner, 'MKT');
    const created = await gqlData(
      owner,
      `mutation ($input: OrganizationInviteCreateInput!) {
        organizationInviteCreate(input: $input) { organizationInvite { id metadata } } }`,
      { input: { email: 'guest@example.com', role: 'guest', teamIds: [teamId] } },
    );
    const invite = {
      id: created.organizationInviteCreate.organizationInvite.id as string,
      token: created.organizationInviteCreate.organizationInvite.metadata.token as string,
    };
    const details = await gql(
      {},
      `{ organizationInviteDetails(id: "${invite.token}") { __typename ... on OrganizationInviteFullDetailsPayload { email role inviter organizationName status expired accepted allowedAuthServices organizationId } } }`,
    );
    expect(details.status).toBe(200);
    expect(details.body.errors).toBeUndefined();
    expect(details.body.data!.organizationInviteDetails).toMatchObject({
      __typename: 'OrganizationInviteFullDetailsPayload',
      email: 'guest@example.com',
      role: 'guest',
      inviter: 'Olivia',
      status: 'pending',
      expired: false,
      accepted: false,
    });
    expect(JSON.stringify(details.body)).not.toContain('Marketing');
    const byId = await gql({}, `{ organizationInviteDetails(id: "${invite.id}") { __typename } }`);
    expect(errorCode(byId)).toBe('ENTITY_NOT_FOUND');
    const mixed = await gql(
      {},
      `{ organizationInviteDetails(id: "${invite.token}") { __typename } viewer { id } }`,
    );
    expect(errorCode(mixed)).toBe('AUTHENTICATION_ERROR');
    const viewer = await gql({}, '{ viewer { id } }');
    expect(errorCode(viewer)).toBe('AUTHENTICATION_ERROR');
  });

  it('lists the approved domains in the organization auth settings', async () => {
    const previous = process.env.APPROVED_EMAIL_DOMAINS;
    process.env.APPROVED_EMAIL_DOMAINS = 'example.com, Corp.Test';
    try {
      const owner = await signUpTestUser();
      const res = await gql(as(owner.cookie), '{ organization { authSettings } }');
      expect(res.body.errors).toBeUndefined();
      const auth = (res.body.data!.organization as { authSettings: { approvedDomains: string[] } })
        .authSettings;
      expect(auth.approvedDomains).toEqual(['example.com', 'corp.test']);
    } finally {
      if (previous === undefined) delete process.env.APPROVED_EMAIL_DOMAINS;
      else process.env.APPROVED_EMAIL_DOMAINS = previous;
    }
  });

  it('reports project progress and scope', async () => {
    const owner = await signUpTestUser();
    const { teamId, backlogId, completedId } = await setupTeam(owner);
    const project = await createProject(owner, { teamIds: [teamId], name: 'Launch' });
    for (const stateId of [backlogId, backlogId, completedId])
      await createIssue(owner, { teamId: 'MKT', stateId, title: 'T', projectId: project.id });
    const res = await gql(
      as(owner.cookie),
      `{ project(id: "${project.id}") { progress scope scopeHistory completedScopeHistory issueCountHistory completedIssueCountHistory } }`,
    );
    expect(res.body.errors).toBeUndefined();
    const p = res.body.data!.project as Record<string, unknown>;
    expect(p.progress as number).toBeCloseTo(1 / 3, 5);
    expect(p).toMatchObject({
      scope: 3,
      scopeHistory: [3],
      completedScopeHistory: [1],
      issueCountHistory: [3],
      completedIssueCountHistory: [1],
    });
  });
});
