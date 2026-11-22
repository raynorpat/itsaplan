import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, notificationDelivery } from '@repo/db';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Notification email goes out through the instance email provider whenever one is
// configured; teams have no email settings of their own.

describe('notification email', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('queues email with only the instance provider', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie);
    await api.teams.post({ key: 'MKT', name: 'Marketing' });
    const view = (await api.teams({ teamKey: 'MKT' }).get()).data!;
    const member = await signUpTestUser();
    await api.teams({ teamKey: 'MKT' }).members.post({ userId: member.userId });
    // The provider comes from the environment; set after the sign-ups so their magic
    // links are logged rather than sent.
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_FROM = 'Plan <plan@example.com>';
    const asMember = authedApi(member.cookie);
    const saved = await asMember.account['notification-preferences'].patch({
      emailCategories: { assignments: true, mentions: false },
    });
    expect(saved.status).toBe(200);
    await api
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId: view.states[0]!.id, title: 'T', assigneeUserId: member.userId });
    const rows = await db.select().from(notificationDelivery);
    expect(rows.map((r) => [r.channel, r.recipient])).toEqual([['email', member.email]]);
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.EMAIL_FROM;
  });
});
