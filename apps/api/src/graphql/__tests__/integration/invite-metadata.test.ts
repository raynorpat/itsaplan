import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// OrganizationInvite.metadata carries the invite's team ids for anyone who may list
// invites, and the invite link's token only for the invite's sender and for admins
// and owners, as the REST invite list shows it.

type Invite = { id: string; email: string; metadata: { token?: string; teamIds: string[] } };

const LIST = `{ organizationInvites { nodes { id email metadata } } }`;
const CREATE = `mutation($input: OrganizationInviteCreateInput!) {
  organizationInviteCreate(input: $input) { success organizationInvite { id metadata } }
}`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await authedApi(owner.cookie).teams.post({ key: 'MKT', name: 'Marketing' });
  const teamId = (await authedApi(owner.cookie).teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const sender = await signUpWithRole('member', { name: 'Sender' });
  const other = await signUpWithRole('member', { name: 'Other' });
  return { owner, teamId, sender, other };
}

const listed = async (cookie: string, email: string) => {
  const res = await gql({ cookie }, LIST);
  const nodes = (res.body.data?.organizationInvites as { nodes: Invite[] }).nodes;
  return nodes.find((n) => n.email === email)!;
};

describe('graphql invite metadata', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('gives the sender the token and team ids in the create payload', async () => {
    const { teamId, sender } = await setup();
    const res = await gql({ cookie: sender.cookie }, CREATE, {
      input: { email: 'new@example.com', role: 'user', teamIds: [teamId] },
    });
    const invite = (res.body.data?.organizationInviteCreate as { organizationInvite: Invite })
      .organizationInvite;
    expect(invite.metadata.teamIds).toEqual([teamId]);
    expect(invite.metadata.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lists the token for the sender and admins only, team ids for everyone', async () => {
    const { owner, teamId, sender, other } = await setup();
    await gql({ cookie: sender.cookie }, CREATE, {
      input: { email: 'new@example.com', role: 'user', teamIds: [teamId] },
    });
    const admin = await signUpWithRole('admin', { name: 'Admin' });

    const bySender = await listed(sender.cookie, 'new@example.com');
    const byOwner = await listed(owner.cookie, 'new@example.com');
    const byAdmin = await listed(admin.cookie, 'new@example.com');
    const byOther = await listed(other.cookie, 'new@example.com');

    expect(bySender.metadata.token).toBe(byOwner.metadata.token!);
    expect(byAdmin.metadata.token).toBe(byOwner.metadata.token!);
    expect(byOther.metadata.token).toBeUndefined();
    expect(byOther.metadata.teamIds).toEqual([teamId]);

    // The token is the one the invite page looks up.
    const details = await gql(
      {},
      `query($id: String!) { organizationInviteDetails(id: $id) {
        ... on OrganizationInviteFullDetailsPayload { email } } }`,
      { id: byOwner.metadata.token },
    );
    expect(details.body.data?.organizationInviteDetails).toEqual({ email: 'new@example.com' });
  });
});
