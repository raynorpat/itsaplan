import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { addMember, createComment, createIssue, createTeam, gqlData } from '../helpers/graphql';
import { createApiKey } from '../helpers/linear';
import { mcp } from '../helpers/mcp';
import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';

// Features Linear does not have are removed: their old paths answer 404 for a team
// owner, and no MCP tool description mentions them.

async function setup() {
  const owner = await signUpTestUser();
  await createTeam({ cookie: owner.cookie }, { key: 'MKT', name: 'Marketing' });
  const issue = await createIssue({ cookie: owner.cookie }, { teamId: 'MKT', title: 'T' });
  return { cookie: owner.cookie, issueId: issue.id, userId: owner.userId };
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

  it('removes god mode, instance shortcuts and update checks', async () => {
    const { cookie } = await setup();
    const id = crypto.randomUUID();
    const routes: [string, string, unknown?][] = [
      ['GET', '/god/hotkey-settings'],
      ['PUT', '/god/hotkey-settings', {}],
      ['GET', '/god/updates'],
      ['POST', '/god/updates/check'],
      ['GET', '/god/users'],
      ['GET', `/god/users/${id}`],
      ['POST', `/god/users/${id}/verify-email`],
      ['DELETE', `/god/users/${id}`],
      ['GET', '/god/teams'],
      ['GET', `/god/teams/${id}`],
      ['GET', '/settings/hotkeys'],
    ];
    for (const [method, path, body] of routes)
      expect([method, path, await call(cookie, method, path, body)]).toEqual([method, path, 404]);
  });

  it('keeps a comment whose author was deleted', async () => {
    const { cookie, issueId } = await setup();
    const member = await signUpTestUser({ name: 'Gone' });
    await addMember({ cookie }, 'MKT', member.userId);
    const comment = await createComment({ cookie: member.cookie }, { issueId, body: 'Hello' });
    await db.delete(user).where(eq(user.id, member.userId));
    const data = await gqlData(
      { cookie },
      `{ comment(id: "${comment.id}") { id body user { id } } }`,
    );
    expect(data).toEqual({ comment: { id: comment.id, body: 'Hello', user: null } });
  });

  it('documents no removed feature in the MCP tool descriptions', async () => {
    const { cookie } = await setup();
    const key = await createApiKey(cookie);
    const res = await mcp(key, 'tools/list');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.result);
    for (const phrase of ['issue types', 'custom fields', 'AI agent', 'dashboard', 'note board'])
      expect(text).not.toContain(phrase);
  });
});
