// Linear's workspace roles. Owners and admins administer the workspace; guests
// reach only the teams they were added to.
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

// The instance upload limits. Readable by any signed-in user, because the upload UI
// states them before a file is picked. Sizes come from the environment, accepted
// types from the workspace settings.
export interface StorageSettings {
  maxAttachmentMb: number;
  maxAvatarMb: number;
  // Accepted attachment content types: a full type ('application/pdf') or a
  // wildcard ('image/*'). Empty means any type is accepted.
  attachmentMimeTypes: string[];
  // Stored attachment bytes allowed per team, in MB. 0 means unlimited.
  teamQuotaMb: number;
}

// The minimum workspace role for an action.
export type MinimumRole = 'owner' | 'admin' | 'member';

// The workspace settings. Readable by any signed-in user; changed by owners and
// admins. approvedDomains (from the environment) is read-only.
export interface OrganizationSettings {
  id: string;
  name: string;
  urlKey: string;
  logoUrl: string | null;
  // 'email' (magic link), 'google', 'passkey'. Empty means every configured one.
  allowedAuthServices: string[];
  allowedFileUploadContentTypes: string[];
  teamCreationRole: MinimumRole;
  labelManagementRole: MinimumRole;
  invitationsRole: MinimumRole;
  approvedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export type OrganizationSettingsPatch = Partial<
  Pick<
    OrganizationSettings,
    | 'name'
    | 'urlKey'
    | 'logoUrl'
    | 'allowedAuthServices'
    | 'allowedFileUploadContentTypes'
    | 'teamCreationRole'
    | 'labelManagementRole'
    | 'invitationsRole'
  >
>;

// Outgoing webhook subscription (mirrors apps/api webhooks/store.ts). The
// resource types must stay in sync with WEBHOOK_RESOURCE_TYPES on the server.
export type WebhookResourceType =
  | 'Issue'
  | 'Comment'
  | 'IssueLabel'
  | 'Project'
  | 'ProjectUpdate'
  | 'Reaction'
  | 'Cycle'
  | 'Initiative'
  | 'InitiativeUpdate'
  | 'Document'
  | 'Attachment';

export interface Webhook {
  id: string;
  teamId: string | null;
  allPublicTeams: boolean;
  url: string;
  label: string | null;
  secret: string;
  resourceTypes: WebhookResourceType[];
  enabled: boolean;
  creatorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// A user of the workspace, as owners and admins manage them.
export interface WorkspaceUser {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  // Suspension is Linear's way to remove someone.
  suspended: boolean;
  createdAt: string;
}

// The roles an invite can carry; owners are made by an owner after sign-up.
export type InviteRole = 'admin' | 'member' | 'guest';

// A pending workspace invite: the account created for its email takes its role
// and joins its teams.
export interface InviteRow {
  id: string;
  // Null unless the viewer sent the invite or is an admin or owner.
  token: string | null;
  email: string;
  role: InviteRole;
  teamIds: string[];
  createdAt: string;
  expiresAt: string;
  invitedByUserId: string | null;
  invitedByName: string | null;
}
