import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { authedApi } from '../helpers/app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';

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
  return { cookie: owner.cookie, issueId: issue.id };
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
});
