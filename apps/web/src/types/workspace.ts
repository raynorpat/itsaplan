// Linear's workspace roles. Owners and admins administer the workspace; guests
// reach only the teams they were added to.
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

// The roles an invite can carry; owners are made by an owner after sign-up.
export type InviteRole = 'admin' | 'member' | 'guest';
