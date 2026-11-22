import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { authedApi } from '../helpers/app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gql } from '../helpers/linear';
import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';

// Features Linear does not have are removed: their routes answer 404 for a team
// owner. The routes are no longer in the typed client, so requests go through
// app.handle directly.

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await api.teams({ teamKey: 'MKT' }).get()).data!;
  const issue = (
    await api.teams({ teamKey: 'MKT' }).issues.post({ stateId: view.states[0]!.id, title: 'T' })
  ).data!;
  return { cookie: owner.cookie, issueId: issue.id, api, userId: owner.userId };
}

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app
    .handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    .then((r) => r.status);

describe('removed features', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('removes dashboards, note boards, analytics, share links, webhook test and team copy', async () => {
    const { cookie, issueId } = await setup();
    const id = crypto.randomUUID();
    const routes: [string, string, unknown?][] = [
      ['GET', '/teams/MKT/dashboards'],
      ['POST', '/teams/MKT/dashboards', { name: 'D' }],
      ['DELETE', `/dashboards/${id}`],
      ['GET', '/teams/MKT/note-boards'],
      ['POST', '/teams/MKT/note-boards', { name: 'N' }],
      ['GET', '/teams/MKT/analytics/stats'],
      ['GET', '/teams/MKT/analytics/throughput'],
      ['POST', `/issues/${issueId}/share`],
      ['GET', `/share/issue/${id}`],
      ['GET', `/share/view/${id}`],
      ['GET', '/webhook-test/sink'],
      ['POST', '/webhook-test/sink', {}],
      ['POST', '/teams/MKT/copy', { key: 'CPY', name: 'Copy' }],
    ];
    for (const [method, path, body] of routes)
      expect([method, path, await call(cookie, method, path, body)]).toEqual([method, path, 404]);
  });

  it('removes Telegram and team email settings', async () => {
    const { cookie } = await setup();
    const routes: [string, string, unknown?][] = [
      ['GET', '/telegram/account'],
      ['POST', '/telegram/account/link', {}],
      ['DELETE', '/telegram/account'],
      ['GET', '/teams/MKT/notification-settings'],
      ['PUT', '/teams/MKT/notification-settings', {}],
    ];
    for (const [method, path, body] of routes)
      expect([method, path, await call(cookie, method, path, body)]).toEqual([method, path, 404]);
  });

  it('removes team actions, issue types and custom fields', async () => {
    const { cookie, issueId } = await setup();
    const id = crypto.randomUUID();
    const routes: [string, string, unknown?][] = [
      ['GET', '/teams/MKT/actions'],
      ['POST', '/teams/MKT/actions', { name: 'A' }],
      ['PUT', '/teams/MKT/actions/reorder', { ids: [] }],
      ['PATCH', `/actions/${id}`, { name: 'A' }],
      ['DELETE', `/actions/${id}`],
      ['POST', '/teams/MKT/issue-types', { name: 'Bug' }],
      ['PATCH', `/teams/MKT/issue-types/${id}`, { name: 'Bug' }],
      ['DELETE', `/teams/MKT/issue-types/${id}`],
      ['GET', '/teams/MKT/custom-fields'],
      ['POST', '/teams/MKT/custom-fields', { name: 'F', type: 'text' }],
      ['PATCH', `/teams/MKT/custom-fields/${id}`, { name: 'F' }],
      ['DELETE', `/teams/MKT/custom-fields/${id}`],
      ['PUT', `/issues/${issueId}/fields/${id}`, { value: 'x' }],
    ];
    for (const [method, path, body] of routes)
      expect([method, path, await call(cookie, method, path, body)]).toEqual([method, path, 404]);
  });

  it('removes the built-in AI agents', async () => {
    const { cookie } = await setup();
    const id = crypto.randomUUID();
    const routes: [string, string, unknown?][] = [
      ['GET', '/teams/MKT/ai-agents'],
      ['POST', '/teams/MKT/ai-agents', { name: 'Bot' }],
      ['GET', `/teams/MKT/ai-agents/${id}`],
      ['GET', '/teams/MKT/agent-skills'],
      ['GET', `/teams/MKT/agent-skills/${id}`],
      ['GET', '/teams/MKT/agent-tools'],
      ['GET', '/teams/MKT/agent-schedules'],
      ['GET', '/teams/MKT/integrations'],
      ['GET', '/integrations'],
    ];
    for (const [method, path, body] of routes)
      expect([method, path, await call(cookie, method, path, body)]).toEqual([method, path, 404]);
  });

  it('rejects a delegate and allows clearing it', async () => {
    const { cookie, issueId, userId } = await setup();
    const set = await gql(
      { cookie },
      `mutation { issueUpdate(id: "${issueId}", input: { delegateId: "${userId}" }) { success } }`,
    );
    expect(set.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    const clear = await gql(
      { cookie },
      `mutation { issueUpdate(id: "${issueId}", input: { delegateId: null }) { success } }`,
    );
    expect(clear.body.errors).toBeUndefined();
    expect(await call(cookie, 'PATCH', `/issues/${issueId}`, { delegateUserId: userId })).toBe(400);
  });

  it('keeps a comment whose author was deleted', async () => {
    const { cookie, issueId, api } = await setup();
    const member = await signUpTestUser({ name: 'Gone' });
    const invite = await api
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: member.email, role: 'member' });
    await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();
    const created = await authedApi(member.cookie)
      .issues({ issueId })
      .comments.post({ body: 'Hello' } as never);
    const commentId = (created.data as { id: string }).id;
    await db.delete(user).where(eq(user.id, member.userId));
    const res = await gql({ cookie }, `{ comment(id: "${commentId}") { id body user { id } } }`);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data).toEqual({ comment: { id: commentId, body: 'Hello', user: null } });
    const feed = await api.issues({ issueId }).feed.get();
    expect(JSON.stringify(feed.data)).toContain('Gone');
  });
});
