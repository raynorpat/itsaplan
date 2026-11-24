import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { addMember, createTeam, signUpAs } from '../../../__tests__/helpers/graphql';

// Linear's Organization over GraphQL: organization and organizationUpdate, the
// security settings that set who may create teams, manage labels and invite, and the
// input fields this instance does not support.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';
const as = (cookie: string) => ({ cookie });

describe('graphql organization', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reads and updates the organization', async () => {
    await signUpTestUser();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');
    const update = await gql(
      as(admin.cookie),
      `mutation { organizationUpdate(input: { name: "Acme", urlKey: "acme", logoUrl: "https://e.com/l.png", allowedFileUploadContentTypes: ["image/*"] }) { success organization { name urlKey } } }`,
    );
    expect(update.body.errors).toBeUndefined();
    const read = await gql(
      as(member.cookie),
      '{ organization { name urlKey logoUrl allowedFileUploadContentTypes userCount } }',
    );
    expect(read.body.data).toEqual({
      organization: {
        name: 'Acme',
        urlKey: 'acme',
        logoUrl: 'https://e.com/l.png',
        allowedFileUploadContentTypes: ['image/*'],
        userCount: 3,
      },
    });
    const refused = await gql(
      as(member.cookie),
      'mutation { organizationUpdate(input: { name: "Nope" }) { success } }',
    );
    expect(errorCode(refused)).toBe('FORBIDDEN');
  });

  it('maps the security settings onto who may create teams, invite and manage labels', async () => {
    const owner = await signUpTestUser();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');
    const set = await gql(
      as(owner.cookie),
      'mutation { organizationUpdate(input: { securitySettings: { teamCreationRole: admin, invitationsRole: admin, labelManagementRole: owner } }) { success } }',
    );
    expect(set.body.errors).toBeUndefined();
    const flags = await gql(
      as(member.cookie),
      '{ organization { restrictTeamCreationToAdmins restrictLabelManagementToAdmins allowMembersToInvite securitySettings } }',
    );
    expect(flags.body.data?.organization).toMatchObject({
      restrictTeamCreationToAdmins: true,
      restrictLabelManagementToAdmins: true,
      allowMembersToInvite: false,
    });
    const teamCreate = await gql(
      as(member.cookie),
      'mutation { teamCreate(input: { name: "Ops", key: "OPS" }) { success } }',
    );
    expect(errorCode(teamCreate)).toBe('FORBIDDEN');
    expect((await createTeam(admin, { key: 'ADM', name: 'Admins' })).team.key).toBe('ADM');
    const invite = await gql(
      as(member.cookie),
      'mutation { organizationInviteCreate(input: { email: "x@example.com", role: guest }) { success } }',
    );
    expect(errorCode(invite)).toBe('FORBIDDEN');
    const label = await gql(
      as(admin.cookie),
      'mutation { issueLabelCreate(input: { name: "Bug" }) { success } }',
    );
    expect(errorCode(label)).toBe('FORBIDDEN');
    for (const role of ['guest', 'app']) {
      const bad = await gql(
        as(owner.cookie),
        `mutation { organizationUpdate(input: { securitySettings: { teamCreationRole: ${role} } }) { success } }`,
      );
      expect(errorCode(bad)).toBe('INVALID_INPUT');
    }
  });

  it('rejects unsupported organization fields, naming them', async () => {
    const owner = await signUpTestUser();
    const res = await gql(
      as(owner.cookie),
      'mutation { organizationUpdate(input: { roadmapEnabled: true }) { success } }',
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(errorMessage(res)).toContain('roadmapEnabled');
  });

  it("shows a guest only their teams' people and refuses their update", async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const stranger = await signUpAs('member', { name: 'Stranger' });
    const guest = await signUpAs('guest', { name: 'Guest' });
    await createTeam(owner, { key: 'OPS', name: 'Ops' });
    await addMember(owner, 'OPS', guest.userId);
    const res = await gql(as(guest.cookie), '{ organization { users { nodes { name } } } }');
    const names = (
      res.body.data as { organization: { users: { nodes: { name: string }[] } } }
    ).organization.users.nodes.map((u) => u.name);
    expect(names).toContain('Owner');
    expect(names).toContain('Guest');
    expect(names).not.toContain('Stranger');
    expect(stranger.userId).toBeTruthy();
    const update = await gql(
      as(guest.cookie),
      'mutation { organizationUpdate(input: { name: "G" }) { success } }',
    );
    expect(errorCode(update)).toBe('FORBIDDEN');
  });
});
