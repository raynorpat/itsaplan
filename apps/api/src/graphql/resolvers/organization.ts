import { approvedDomains } from '@repo/auth';
import { db, issue, user } from '@repo/db';
import { isNull } from 'drizzle-orm';
import {
  getOrganization as getOrganizationRow,
  updateOrganization,
  type MinimumRole,
  type OrganizationPatch,
} from '../../organization/store';
import type { GraphQLContext } from '../context';
import type { PageArgs } from '../connection';
import { gqlError } from '../errors';
import { issueLabelResolvers } from './issue-label';
import { guard, lastSyncId, onlySupported } from './mutations';
import { projectResolvers } from './project';
import { listUsers, visibleUsers } from './team';

// Linear's Organization: the workspace row (../../organization/store.ts). Who may
// create teams, manage labels and invite is a minimum role, which Linear writes and
// reads through `securitySettings` (UserRoleType: `user` is a member) and also reads
// as the deprecated booleans.

// Linear's name for a minimum role.
const linearRole = (role: string) => (role === 'member' ? 'user' : role);

function minimumRoleFrom(value: unknown, field: string): MinimumRole {
  if (value === 'user') return 'member';
  if (value === 'admin' || value === 'owner') return value;
  throw gqlError('INVALID_INPUT', `${field} must be owner, admin or user`);
}

export async function getOrganization() {
  const org = await getOrganizationRow();
  return {
    id: org.id,
    name: org.name,
    urlKey: org.urlKey,
    logoUrl: org.logoUrl,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    gitBranchFormat: '{issueIdentifier}-{issueTitle}',
    allowedAuthServices: org.allowedAuthServices,
    allowedFileUploadContentTypes: org.allowedFileUploadContentTypes,
    // approvedDomains is read-only: it comes from APPROVED_EMAIL_DOMAINS.
    authSettings: {
      allowedAuthServices: org.allowedAuthServices,
      approvedDomains: approvedDomains(),
    },
    securitySettings: {
      teamCreationRole: linearRole(org.teamCreationRole),
      labelManagementRole: linearRole(org.labelManagementRole),
      invitationsRole: linearRole(org.invitationsRole),
    },
    restrictTeamCreationToAdmins: org.teamCreationRole !== 'member',
    restrictLabelManagementToAdmins: org.labelManagementRole !== 'member',
    allowMembersToInvite: org.invitationsRole === 'member',
    // Customers (customers/settings.ts): on or off, and the revenue currency.
    customersEnabled: org.customersEnabled,
    customersConfiguration: { revenueCurrency: org.customersRevenueCurrency },
  };
}

type Input = Record<string, unknown>;

export const organizationResolvers = {
  Query: {
    organization: () => getOrganization(),
  },
  Organization: {
    // Active (not suspended) users of the workspace.
    userCount: async () => db.$count(user, isNull(user.suspendedAt)),
    createdIssueCount: async () => db.$count(issue),
    users: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      listUsers(visibleUsers(ctx.user.id), args, ctx.user.id),
    labels: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      issueLabelResolvers.Query.issueLabels(_, args, ctx),
    projectLabels: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      projectResolvers.Query.projectLabels(_, args, ctx),
    projectStatuses: async () => (await projectResolvers.Query.projectStatuses()).nodes,
  },
  Mutation: {
    organizationUpdate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          [
            'name',
            'urlKey',
            'logoUrl',
            'allowedFileUploadContentTypes',
            'authSettings',
            'securitySettings',
          ],
          'input',
        );
        const patch: OrganizationPatch = {};
        if (input.name != null) patch.name = String(input.name);
        if (input.urlKey != null) patch.urlKey = String(input.urlKey);
        if (input.logoUrl !== undefined)
          patch.logoUrl = input.logoUrl === null ? null : String(input.logoUrl);
        if (Array.isArray(input.allowedFileUploadContentTypes))
          patch.allowedFileUploadContentTypes = input.allowedFileUploadContentTypes.map(String);
        const auth = input.authSettings as Input | null | undefined;
        if (auth) {
          onlySupported(auth, ['allowedAuthServices'], 'input.authSettings');
          if (Array.isArray(auth.allowedAuthServices))
            patch.allowedAuthServices = auth.allowedAuthServices.map(String);
        }
        const security = input.securitySettings as Input | null | undefined;
        if (security) {
          onlySupported(
            security,
            ['teamCreationRole', 'labelManagementRole', 'invitationsRole'],
            'input.securitySettings',
          );
          for (const field of [
            'teamCreationRole',
            'labelManagementRole',
            'invitationsRole',
          ] as const)
            if (security[field] != null)
              patch[field] = minimumRoleFrom(security[field], `input.securitySettings.${field}`);
        }
        await updateOrganization(patch, ctx.user);
        return { success: true, lastSyncId: lastSyncId(), organization: await getOrganization() };
      }),
  },
};
