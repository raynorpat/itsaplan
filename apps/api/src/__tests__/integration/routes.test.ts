import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { createIssue, createTeam } from '../helpers/graphql';

// The instance's data API is /graphql. Besides it, better-auth and MCP, the API serves
// only the health check, the file routes and the worker's internal routes. Every REST
// data route is gone.

const call = (method: string, path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { method, headers }));

describe('routes', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('answers 404 for the removed REST paths, with or without a session', async () => {
    const owner = await signUpTestUser();
    await createTeam({ cookie: owner.cookie }, { key: 'MKT' });
    const issue = await createIssue({ cookie: owner.cookie }, { teamId: 'MKT', title: 'T' });
    const removed: [string, string][] = [
      ['GET', '/teams'],
      ['POST', '/teams'],
      ['GET', '/teams/MKT'],
      ['GET', '/teams/MKT/issues'],
      ['GET', `/issues/${issue.id}`],
      ['PATCH', `/issues/${issue.id}`],
      ['GET', `/issues/${issue.id}/feed`],
      ['GET', '/projects'],
      ['GET', '/notifications'],
      ['GET', '/workspace/users'],
      ['GET', '/organization'],
      ['GET', '/docs'],
      ['GET', '/docs/json'],
      ['GET', '/me'],
      ['POST', '/me/avatar'],
      ['GET', '/auth-config'],
      ['GET', '/settings/storage'],
      ['GET', '/settings/version'],
      ['POST', `/issues/${issue.id}/attachments`],
      ['POST', `/issues/${issue.id}/attachments/import`],
      // One path per feature Linear does not have, which this instance removed.
      ['GET', '/teams/MKT/note-boards'],
      ['GET', '/teams/MKT/analytics/stats'],
      ['POST', `/issues/${issue.id}/share`],
      ['GET', `/share/issue/${issue.id}`],
      ['POST', '/webhook-test/sink'],
      ['POST', '/teams/MKT/copy'],
      ['GET', '/telegram/account'],
      ['GET', '/teams/MKT/notification-settings'],
      ['GET', '/teams/MKT/actions'],
      ['POST', '/teams/MKT/issue-types'],
      ['GET', '/teams/MKT/custom-fields'],
      ['GET', '/teams/MKT/ai-agents'],
      ['GET', '/integrations'],
      ['GET', '/god/users'],
      ['GET', '/god/updates'],
      ['GET', '/settings/hotkeys'],
    ];
    for (const headers of [{ cookie: owner.cookie }, {}] as Record<string, string>[])
      for (const [method, path] of removed)
        expect([method, path, (await call(method, path, headers)).status]).toEqual([
          method,
          path,
          404,
        ]);
  });

  it('serves the health check without a session', async () => {
    const res = await call('GET', '/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "It's a Plan api", status: 'ok' });
  });

  it('serves the file routes without a session', async () => {
    const id = crypto.randomUUID();
    // Unknown ids: the routes run (404 from the handler), not a 401.
    for (const [method, path] of [
      ['GET', `/uploads/${id}/raw`],
      ['GET', `/attachments/${id}/raw`],
      ['GET', `/avatars/${id}/raw`],
      ['PUT', `/uploads/${id}`],
    ] as [string, string][]) {
      const res = await call(method, path);
      expect([path, res.status]).toEqual([path, 404]);
      expect((await res.json()).error).toBeString();
    }
    // A malformed id is a 400, as before.
    expect((await call('PUT', '/uploads/not-a-uuid')).status).toBe(400);
  });

  it('keeps the internal routes, refused without the worker token', async () => {
    // Routes with a body schema refuse an empty body before the token check; the
    // token rules have their own tests (internal-routes).
    for (const path of [
      '/internal/notification-deliveries/send',
      '/internal/webhooks/issues-archived',
    ])
      expect([path, (await call('POST', path)).status]).not.toEqual([path, 404]);
    for (const path of [
      '/internal/cycles/tick',
      '/internal/uploads/cleanup',
      '/internal/projects/purge',
      '/internal/projects/snapshot',
    ])
      expect([path, (await call('POST', path)).status]).toEqual([path, 401]);
  });
});
