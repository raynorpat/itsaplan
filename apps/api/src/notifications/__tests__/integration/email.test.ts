import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, notificationDelivery } from '@repo/db';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { addMember, createIssue, createTeam, gqlData } from '../../../__tests__/helpers/graphql';
import { resetDb } from '../../../__tests__/helpers/db';

// Notification email goes out through the instance email provider whenever one is
// configured; teams have no email settings of their own.

describe('notification email', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('queues email with only the instance provider', async () => {
    const owner = await signUpTestUser();
    const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
    const member = await signUpTestUser();
    await addMember(owner, 'MKT', member.userId);
    // The provider comes from the environment; set after the sign-ups so their magic
    // links are logged rather than sent.
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_FROM = 'Plan <plan@example.com>';
    const saved = await gqlData(
      member,
      `mutation ($id: String!, $input: UserSettingsUpdateInput!) {
        userSettingsUpdate(id: $id, input: $input) { success } }`,
      {
        id: member.userId,
        input: {
          notificationCategoryPreferences: {
            assignments: { email: true },
            mentions: { email: false },
          },
        },
      },
    );
    expect(saved.userSettingsUpdate.success).toBe(true);
    await createIssue(owner, {
      teamId: 'MKT',
      stateId: view.states[0]!.id,
      title: 'T',
      assigneeId: member.userId,
    });
    const rows = await db.select().from(notificationDelivery);
    expect(rows.map((r) => [r.channel, r.recipient])).toEqual([['email', member.email]]);
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.EMAIL_FROM;
  });
});
