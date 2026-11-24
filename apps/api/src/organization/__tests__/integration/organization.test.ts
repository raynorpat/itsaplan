import { beforeEach, describe, expect, it } from 'bun:test';
import { db, verification } from '@repo/db';
import { like } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// The workspace's sign-in services and field limits, set through organizationUpdate.
// Reading and updating the organization, and who may, are in the GraphQL
// organization tests.

const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        origin: process.env.APP_URL!.split(',')[0]!,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );

const linkStored = async (email: string) =>
  (
    await db
      .select({ id: verification.id })
      .from(verification)
      .where(like(verification.value, `%"email":"${email}"%`))
  ).length > 0;

describe('organization sign-in services and limits', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('limits sign-in services, keeping the owner a magic link', async () => {
    const owner = await signUpTestUser();
    const member = await signUpAs('member');
    await gqlData(
      owner,
      'mutation { organizationUpdate(input: { authSettings: { allowedAuthServices: ["google"] } }) { success } }',
    );
    await db.delete(verification);
    const ask = (email: string) =>
      call('/api/auth/sign-in/magic-link', { method: 'POST', body: { email } });
    expect((await ask(member.email)).status).toBe(200);
    expect(await linkStored(member.email)).toBe(false);
    expect((await ask(owner.email)).status).toBe(200);
    expect(await linkStored(owner.email)).toBe(true);
    const passkey = await call('/api/auth/passkey/generate-authenticate-options');
    expect(passkey.status).toBe(403);
  });

  it('limits the name and logo URL lengths', async () => {
    const owner = await signUpTestUser();
    const update = (input: string) =>
      gql({ cookie: owner.cookie }, `mutation { organizationUpdate(input: ${input}) { success } }`);
    const long = await update(`{ name: "${'x'.repeat(256)}" }`);
    expect(long.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    const longLogo = await update(`{ logoUrl: "https://example.com/${'x'.repeat(2048)}" }`);
    expect(longLogo.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    expect((await gqlData(owner, '{ organization { name } }')).organization.name).not.toBe(
      'x'.repeat(256),
    );
  });
});
