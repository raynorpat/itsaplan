import { approvedDomains } from '@repo/auth';
import { db, organization } from '@repo/db';
import { sql } from 'drizzle-orm';
import {
  atLeast,
  assertWorkspaceRole,
  workspaceRole,
  type AuthUser,
  type WorkspaceRole,
} from '../shared/access';
import { HttpError } from '../shared/lib';
import { getAppVersion } from '../settings/updates';

// The workspace (Linear's Organization): one row, created with defaults on first
// read. Owners and admins change it; everyone signed in reads it. Instance secrets and
// server limits are environment variables (../settings/storage.ts, @repo/auth).

export type OrganizationRow = typeof organization.$inferSelect;

// The sign-in services an organization can allow (email = magic link).
export const AUTH_SERVICES = ['email', 'google', 'passkey'] as const;
// The roles a minimum-role setting may hold.
export const MINIMUM_ROLES = ['owner', 'admin', 'member'] as const;
export type MinimumRole = (typeof MINIMUM_ROLES)[number];
export type RoleAction = 'teamCreation' | 'labelManagement' | 'invitations';

// Images, video, PDF, office documents and plain text formats. Executables,
// archives and anything else are refused until an admin adds them.
export const DEFAULT_UPLOAD_TYPES = [
  'image/*',
  'video/*',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
];

export async function getOrganization(): Promise<OrganizationRow> {
  const [row] = await db.select().from(organization).limit(1);
  if (row) return row;
  await db
    .insert(organization)
    .values({ allowedFileUploadContentTypes: DEFAULT_UPLOAD_TYPES })
    .onConflictDoNothing();
  const [created] = await db.select().from(organization).limit(1);
  return created!;
}

export interface OrganizationPatch {
  name?: string;
  urlKey?: string;
  logoUrl?: string | null;
  allowedAuthServices?: string[];
  allowedFileUploadContentTypes?: string[];
  teamCreationRole?: string;
  labelManagementRole?: string;
  invitationsRole?: string;
}

const URL_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function minimumRoleOf(value: string, field: string): MinimumRole {
  if (!(MINIMUM_ROLES as readonly string[]).includes(value))
    throw new HttpError(400, `${field} must be owner, admin or member`);
  return value as MinimumRole;
}

function validatePatch(patch: OrganizationPatch): Partial<typeof organization.$inferInsert> {
  const set: Partial<typeof organization.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new HttpError(400, 'name must not be empty');
    set.name = name;
  }
  if (patch.urlKey !== undefined) {
    const key = patch.urlKey.trim().toLowerCase();
    if (!URL_KEY_RE.test(key))
      throw new HttpError(400, 'urlKey must be letters, digits and dashes (at most 64)');
    set.urlKey = key;
  }
  if (patch.logoUrl !== undefined) {
    if (patch.logoUrl !== null && !/^https?:\/\//i.test(patch.logoUrl))
      throw new HttpError(400, 'logoUrl must be an http or https URL');
    set.logoUrl = patch.logoUrl;
  }
  if (patch.allowedAuthServices !== undefined) {
    const services = [...new Set(patch.allowedAuthServices.map((s) => s.trim().toLowerCase()))];
    const unknown = services.find((s) => !(AUTH_SERVICES as readonly string[]).includes(s));
    if (unknown) throw new HttpError(400, `Unknown sign-in service: ${unknown}`);
    set.allowedAuthServices = services;
  }
  if (patch.allowedFileUploadContentTypes !== undefined) {
    // Matched case-insensitively; stored normalized so the settings UI shows what applies.
    set.allowedFileUploadContentTypes = [
      ...new Set(
        patch.allowedFileUploadContentTypes.map((m) => m.trim().toLowerCase()).filter(Boolean),
      ),
    ];
  }
  if (patch.teamCreationRole !== undefined)
    set.teamCreationRole = minimumRoleOf(patch.teamCreationRole, 'teamCreationRole');
  if (patch.labelManagementRole !== undefined)
    set.labelManagementRole = minimumRoleOf(patch.labelManagementRole, 'labelManagementRole');
  if (patch.invitationsRole !== undefined)
    set.invitationsRole = minimumRoleOf(patch.invitationsRole, 'invitationsRole');
  return set;
}

// Owners and admins only.
export async function updateOrganization(
  patch: OrganizationPatch,
  actor: AuthUser | null | undefined,
): Promise<OrganizationRow> {
  await assertWorkspaceRole(actor, 'admin');
  const set = validatePatch(patch);
  const current = await getOrganization();
  if (Object.keys(set).length === 0) return current;
  const [row] = await db
    .update(organization)
    .set({ ...set, updatedAt: sql`now()` })
    .returning();
  return row!;
}

// The minimum workspace role for an action (owner > admin > member; guests never).
export async function minimumRole(action: RoleAction): Promise<MinimumRole> {
  const org = await getOrganization();
  const value =
    action === 'teamCreation'
      ? org.teamCreationRole
      : action === 'labelManagement'
        ? org.labelManagementRole
        : org.invitationsRole;
  return (MINIMUM_ROLES as readonly string[]).includes(value) ? (value as MinimumRole) : 'owner';
}

const ACTION_REFUSAL: Record<RoleAction, string> = {
  teamCreation: 'You cannot create teams in this workspace',
  labelManagement: 'You cannot manage workspace labels in this workspace',
  invitations: 'You cannot invite people to this workspace',
};

// 403 unless the user's workspace role reaches the action's minimum role.
export async function assertAllowedTo(
  user: AuthUser | null | undefined,
  action: RoleAction,
): Promise<AuthUser> {
  const current = await assertWorkspaceRole(user, 'member');
  if (!atLeast(await workspaceRole(current.id), (await minimumRole(action)) as WorkspaceRole))
    throw new HttpError(403, ACTION_REFUSAL[action]);
  return current;
}

// The organization as the web's workspace settings page reads it.
export async function organizationDto() {
  const org = await getOrganization();
  return {
    id: org.id,
    name: org.name,
    urlKey: org.urlKey,
    logoUrl: org.logoUrl,
    allowedAuthServices: org.allowedAuthServices,
    allowedFileUploadContentTypes: org.allowedFileUploadContentTypes,
    teamCreationRole: org.teamCreationRole,
    labelManagementRole: org.labelManagementRole,
    invitationsRole: org.invitationsRole,
    approvedDomains: approvedDomains(),
    version: getAppVersion(),
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}
