import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toInviteRow } from '@/features/workspace/utils/invites';
import {
  toOrganizationInput,
  toOrganizationSettings,
} from '@/features/workspace/utils/organization';

// Invites and the organization as Linear's GraphQL returns them, mapped to what the
// workspace pages show, and the settings form mapped back to Linear's input.

const invite = (metadata: unknown) => ({
  id: 'inv-1',
  email: 'new@example.com',
  role: 'user',
  createdAt: '2026-03-01T00:00:00.000Z',
  expiresAt: '2026-03-08T00:00:00.000Z',
  metadata,
  inviter: { id: 'u1', name: 'Ann' },
});

describe('toInviteRow', () => {
  it('carries the link token and teams from metadata', () => {
    const row = toInviteRow(invite({ token: 'tok', teamIds: ['t1', 't2'] }));
    assert.equal(row.token, 'tok');
    assert.deepEqual(row.teamIds, ['t1', 't2']);
    assert.equal(row.role, 'member');
    assert.equal(row.invitedByUserId, 'u1');
    assert.equal(row.invitedByName, 'Ann');
  });

  it('has no token when metadata holds only the teams', () => {
    const row = toInviteRow(invite({ teamIds: ['t1'] }));
    assert.equal(row.token, null);
    assert.deepEqual(row.teamIds, ['t1']);
  });

  it('reads missing or malformed metadata as no token and no teams', () => {
    const row = toInviteRow({ ...invite(null), inviter: null });
    assert.equal(row.token, null);
    assert.deepEqual(row.teamIds, []);
    assert.equal(row.invitedByName, null);
  });
});

describe('organization mapping', () => {
  const node = {
    id: 'o1',
    name: 'Acme',
    urlKey: 'acme',
    logoUrl: null,
    allowedFileUploadContentTypes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    authSettings: { allowedAuthServices: ['email'], approvedDomains: ['acme.com'] },
    securitySettings: {
      teamCreationRole: 'user',
      labelManagementRole: 'admin',
      invitationsRole: 'owner',
    },
  };

  it('reads Linear minimum roles (user = member) and approved domains', () => {
    const org = toOrganizationSettings(node);
    assert.equal(org.teamCreationRole, 'member');
    assert.equal(org.labelManagementRole, 'admin');
    assert.equal(org.invitationsRole, 'owner');
    assert.deepEqual(org.approvedDomains, ['acme.com']);
    assert.deepEqual(org.allowedAuthServices, ['email']);
  });

  it('writes only the changed fields, minimum roles as Linear names', () => {
    assert.deepEqual(toOrganizationInput({ name: 'New', teamCreationRole: 'member' }), {
      name: 'New',
      securitySettings: { teamCreationRole: 'user' },
    });
    assert.deepEqual(toOrganizationInput({ allowedAuthServices: ['google'] }), {
      authSettings: { allowedAuthServices: ['google'] },
    });
  });
});
