import type {
  MinimumRole,
  OrganizationSettings,
  OrganizationSettingsPatch,
} from '@/types/workspace';

// Linear names the member minimum role `user`.
const fromLinear = (role: string): MinimumRole =>
  role === 'owner' || role === 'admin' ? role : 'member';
type LinearMinimumRole = 'owner' | 'admin' | 'user';
const toLinear = (role: MinimumRole): LinearMinimumRole => (role === 'member' ? 'user' : role);

type OrganizationNode = {
  id: string;
  name: string;
  urlKey: string;
  logoUrl?: string | null;
  allowedFileUploadContentTypes?: string[] | null;
  createdAt: string;
  updatedAt: string;
  // JSON objects in Linear's schema.
  authSettings: Record<string, unknown>;
  securitySettings: Record<string, unknown>;
};

const stringList = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

export function toOrganizationSettings(node: OrganizationNode): OrganizationSettings {
  return {
    id: node.id,
    name: node.name,
    urlKey: node.urlKey,
    logoUrl: node.logoUrl ?? null,
    allowedAuthServices: stringList(node.authSettings.allowedAuthServices),
    allowedFileUploadContentTypes: node.allowedFileUploadContentTypes ?? [],
    teamCreationRole: fromLinear(String(node.securitySettings.teamCreationRole)),
    labelManagementRole: fromLinear(String(node.securitySettings.labelManagementRole)),
    invitationsRole: fromLinear(String(node.securitySettings.invitationsRole)),
    approvedDomains: stringList(node.authSettings.approvedDomains),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

const ROLE_FIELDS = ['teamCreationRole', 'labelManagementRole', 'invitationsRole'] as const;

// The settings form's changes as Linear's OrganizationUpdateInput: sign-in methods
// under authSettings, minimum roles under securitySettings.
export interface OrganizationInput {
  name?: string;
  urlKey?: string;
  logoUrl?: string | null;
  allowedFileUploadContentTypes?: string[];
  authSettings?: { allowedAuthServices: string[] };
  securitySettings?: Partial<Record<(typeof ROLE_FIELDS)[number], LinearMinimumRole>>;
}

export function toOrganizationInput(patch: OrganizationSettingsPatch): OrganizationInput {
  const input: OrganizationInput = {};
  if (patch.name !== undefined) input.name = patch.name;
  if (patch.urlKey !== undefined) input.urlKey = patch.urlKey;
  if (patch.logoUrl !== undefined) input.logoUrl = patch.logoUrl;
  if (patch.allowedFileUploadContentTypes !== undefined)
    input.allowedFileUploadContentTypes = patch.allowedFileUploadContentTypes;
  if (patch.allowedAuthServices !== undefined)
    input.authSettings = { allowedAuthServices: patch.allowedAuthServices };
  const security: OrganizationInput['securitySettings'] = {};
  for (const field of ROLE_FIELDS) {
    const role = patch[field];
    if (role !== undefined) security[field] = toLinear(role);
  }
  if (Object.keys(security).length) input.securitySettings = security;
  return input;
}
