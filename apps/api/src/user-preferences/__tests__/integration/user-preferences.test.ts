import { describe, it, expect, beforeEach } from 'bun:test';
import { api, authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// The account time zone is self-scoped: a user only ever reads and writes their own
// row, so there is no team or permission wiring to cover. A read before any write
// returns UTC instead of failing. The other interface preferences are kept in the
// browser.

describe('user preferences', () => {
  beforeEach(resetDb);

  it('returns UTC when nothing was saved', async () => {
    const u = await signUpTestUser();
    const res = await authedApi(u.cookie).account.preferences.get();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ timezone: 'UTC' });
  });

  it('saves the time zone and reads it back', async () => {
    const client = authedApi((await signUpTestUser()).cookie);
    const res = await client.account.preferences.patch({ timezone: 'Europe/Berlin' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ timezone: 'Europe/Berlin' });
    expect((await client.account.preferences.get()).data).toEqual({ timezone: 'Europe/Berlin' });
  });

  it('rejects an unknown timezone', async () => {
    const client = authedApi((await signUpTestUser()).cookie);
    const res = await client.account.preferences.patch({ timezone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
  });

  it('keeps each user on their own time zone', async () => {
    const a = authedApi((await signUpTestUser()).cookie);
    const b = authedApi((await signUpTestUser()).cookie);
    await a.account.preferences.patch({ timezone: 'Asia/Tokyo' });
    expect((await b.account.preferences.get()).data).toEqual({ timezone: 'UTC' });
  });

  it('rejects a request without a session', async () => {
    expect((await api.account.preferences.get()).status).toBe(401);
    expect((await api.account.preferences.patch({ timezone: 'UTC' })).status).toBe(401);
  });
});
