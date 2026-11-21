import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// The Linear-compatible GraphQL endpoint: authentication, the viewer, the
// organization, and the error for operations not implemented yet.

describe('graphql endpoint', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects a request without credentials with 401', async () => {
    const res = await gql({}, '{ viewer { id } }');
    expect(res.status).toBe(401);
    expect(res.body.errors?.[0].extensions?.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects an unknown API key with 401', async () => {
    const res = await gql({ authorization: 'itp_not-a-real-key' }, '{ viewer { id } }');
    expect(res.status).toBe(401);
  });

  it('resolves the viewer through the Linear SDK with a raw API key', async () => {
    const user = await signUpTestUser({ name: 'Ada' });
    const viewer = await linearClient(await createApiKey(user.cookie)).viewer;
    expect(viewer.id).toBe(user.userId);
    expect(viewer.email).toBe(user.email);
    expect(viewer.name).toBe('Ada');
  });

  it('accepts a Bearer API key', async () => {
    const user = await signUpTestUser();
    const key = await createApiKey(user.cookie);
    const res = await gql({ authorization: `Bearer ${key}` }, '{ viewer { id } }');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ viewer: { id: user.userId } });
  });

  it('accepts a session cookie', async () => {
    const user = await signUpTestUser();
    const res = await gql({ cookie: user.cookie }, '{ viewer { id } }');
    expect(res.body.data).toEqual({ viewer: { id: user.userId } });
  });

  it('returns one stable organization', async () => {
    const user = await signUpTestUser();
    const client = linearClient(await createApiKey(user.cookie));
    const first = await client.organization;
    const second = await client.organization;
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).toBe(first.id);
  });

  it('answers an operation that is not implemented with NOT_IMPLEMENTED', async () => {
    const user = await signUpTestUser();
    const res = await gql({ cookie: user.cookie }, '{ cycles { nodes { id } } }');
    expect(res.body.errors?.[0].extensions?.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.errors?.[0].message).toContain('cycles');
  });
});
