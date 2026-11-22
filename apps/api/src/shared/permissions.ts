// Permission model for team roles. A role carries a matrix: for each resource
// the create/edit/read/delete flags. The matrix is stored as jsonb on
// team_role and enforced here and in shared/access.ts. Owners bypass the
// matrix entirely (full access).
//
// Resources map to the areas a team exposes:
//   work_items     issues, their comments, attachments, and the board view
//   projects    projects (issue groupings) and their activity feed
//   views          saved work-items views
//   members_invite team invites
//   members_manage the member list (view/remove members)
//   states         workflow columns
//   labels         labels and label groups
//   webhooks       outgoing webhook subscriptions
//   danger_zone    team-level settings and deletion

export const PERMISSION_RESOURCES = [
  'work_items',
  'projects',
  'views',
  'members_invite',
  'members_manage',
  'states',
  'labels',
  'webhooks',
  'danger_zone',
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_ACTIONS = ['create', 'edit', 'read', 'delete'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ResourcePermissions = Record<PermissionAction, boolean>;
export type Permissions = Record<PermissionResource, ResourcePermissions>;

function fill(value: boolean): ResourcePermissions {
  return { create: value, edit: value, read: value, delete: value };
}

// All flags false — the base a normalizer starts from.
export function emptyPermissions(): Permissions {
  return Object.fromEntries(PERMISSION_RESOURCES.map((r) => [r, fill(false)])) as Permissions;
}

// All flags true — the effective matrix for an owner (owners bypass checks, but
// this is returned so a member context always carries a resolved matrix).
export function fullPermissions(): Permissions {
  return Object.fromEntries(PERMISSION_RESOURCES.map((r) => [r, fill(true)])) as Permissions;
}

// The default "Member" role assigned to members that join a team. Full access
// to work items, read-only on views, and no access to member
// management, invites, or team settings. read is left on for the entity
// resources the board and issue editors need to render (states, labels). Keep
// this in sync with the backfill
// migration that seeds existing teams.
export function defaultMemberPermissions(): Permissions {
  const p = emptyPermissions();
  p.work_items = fill(true);
  p.projects = fill(true);
  p.views.read = true;
  p.states.read = true;
  p.labels.read = true;
  return p;
}

// Coerces arbitrary input (a jsonb blob or a request body) into the canonical
// matrix: every resource and action present, values coerced to booleans, unknown
// keys dropped, missing entries defaulted to false.
export function normalizePermissions(input: unknown): Permissions {
  const out = emptyPermissions();
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const resource of PERMISSION_RESOURCES) {
    const entry = src[resource];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    for (const action of PERMISSION_ACTIONS) {
      out[resource][action] = e[action] === true;
    }
  }
  return out;
}

export function hasPermission(
  permissions: Permissions,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  return permissions[resource]?.[action] === true;
}
