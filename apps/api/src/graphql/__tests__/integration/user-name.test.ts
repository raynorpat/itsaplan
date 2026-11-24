import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData } from '../../../__tests__/helpers/graphql';

// A magic-link sign-up has no name. Like Linear, such an account is named after its
// email's local part until the person sets a name.

describe('User name of an account without one', () => {
  beforeEach(resetDb);

  it('reads as the email local part', async () => {
    const owner = await signUpTestUser({ email: 'pat.owner@example.com', name: '' });
    const data = await gqlData(owner, '{ viewer { name displayName initials } }');
    expect(data.viewer).toEqual({ name: 'pat.owner', displayName: 'pat.owner', initials: 'P' });
  });

  it('keeps a name that is set', async () => {
    const owner = await signUpTestUser({ name: 'Pat Owner' });
    const data = await gqlData(owner, '{ viewer { name displayName } }');
    expect(data.viewer).toEqual({ name: 'Pat Owner', displayName: 'Pat Owner' });
  });
});
