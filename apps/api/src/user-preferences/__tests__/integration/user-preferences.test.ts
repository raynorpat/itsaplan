import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// The account time zone (Linear's User.timezone) is self-scoped: a user reads and
// writes only their own. A read before any write returns UTC.

const timezoneOf = async (who: TestUser) =>
  (await gqlData(who, '{ viewer { timezone } }')).viewer.timezone as string;

const setTimezone = (who: TestUser, timezone: string) =>
  gql(
    { cookie: who.cookie },
    `mutation ($id: String!, $tz: String) { userUpdate(id: $id, input: { timezone: $tz }) { success } }`,
    { id: who.userId, tz: timezone },
  );

describe('account time zone', () => {
  beforeEach(resetDb);

  it('returns UTC when nothing was saved', async () => {
    expect(await timezoneOf(await signUpTestUser())).toBe('UTC');
  });

  it('saves the time zone and reads it back', async () => {
    const u = await signUpTestUser();
    const res = await setTimezone(u, 'Europe/Berlin');
    expect(res.body.errors).toBeUndefined();
    expect(await timezoneOf(u)).toBe('Europe/Berlin');
  });

  it('rejects an unknown timezone', async () => {
    const u = await signUpTestUser();
    const res = await setTimezone(u, 'Mars/Olympus');
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    expect(await timezoneOf(u)).toBe('UTC');
  });

  it("keeps each user on their own time zone and refuses changing someone else's", async () => {
    const a = await signUpTestUser();
    const b = await signUpTestUser();
    await setTimezone(a, 'Asia/Tokyo');
    expect(await timezoneOf(b)).toBe('UTC');
    const other = await gql(
      { cookie: b.cookie },
      `mutation ($id: String!) { userUpdate(id: $id, input: { timezone: "Europe/Paris" }) { success } }`,
      { id: a.userId },
    );
    expect(other.body.errors?.length).toBeGreaterThan(0);
    expect(await timezoneOf(a)).toBe('Asia/Tokyo');
  });
});
