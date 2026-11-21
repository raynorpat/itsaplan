import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, issue } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { api, authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// The worker's auto-archive sweep writes archived_at with raw SQL and reports the
// ids here, so the API sends the Issue updates. The sweep is reproduced with the
// same UPDATE it runs.

const TOKEN = 'test-worker-token';
let previous: string | undefined;

describe('internal webhook routes', () => {
  beforeAll(() => {
    previous = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = TOKEN;
  });
  afterAll(() => {
    process.env.WORKER_INTERNAL_TOKEN = previous;
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('sends an Issue update with a null actor for each auto-archived issue', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
    const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/hook', resourceTypes: ['Issue'] })
    ).data!;
    const created = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .issues.post({ stateId: team.states[0].id, title: 'x' })
    ).data!;
    await db
      .update(issue)
      .set({ archivedAt: sql`now()` })
      .where(eq(issue.id, created.id));

    const res = await api.internal.webhooks['issues-archived'].post(
      { issueIds: [created.id] },
      { headers: { 'x-worker-token': TOKEN } },
    );
    expect(res.status).toBe(200);
    const items = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!.items;
    expect(items[0]!.payload).toMatchObject({
      action: 'update',
      actor: null,
      data: { id: created.id },
      updatedFrom: { archivedAt: null },
    });
  });

  it('rejects a missing worker token', async () => {
    const res = await api.internal.webhooks['issues-archived'].post({ issueIds: [] });
    expect(res.status).toBe(401);
  });
});
