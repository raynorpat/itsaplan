// Query keys shared by every service. Each is a stable tuple; a team/issue id
// or key scopes its entry. Kept in one registry so a mutation in one service can
// invalidate another service's queries by the same key.
export const qk = {
  teams: ['teams'] as const,
  // The board scaffold (columns/types/labels/fields/viewer) for a team.
  team: (teamKey: string) => ['workItems', teamKey] as const,
  // The board's issues + change marker for a team. Split from the scaffold so
  // issue writes and live-refresh touch only the issues, not the scaffold.
  boardIssues: (teamKey: string) => ['boardIssues', teamKey] as const,
  // A team's archived issues and its auto-archive settings (the Archive section).
  archivedIssues: (teamKey: string) => ['archivedIssues', teamKey] as const,
  // Command-palette issue search, scoped to a team and the search term.
  issueSearch: (teamKey: string, q: string) => ['issueSearch', teamKey, q] as const,
  teamSettings: (teamKey: string) => ['teamSettings', teamKey] as const,
  // A team's notification delivery settings (the Notifications section).
  notificationPreferences: (teamKey: string) => ['notificationPreferences', teamKey] as const,
  views: (teamKey: string) => ['views', teamKey] as const,
  webhooks: (teamKey: string) => ['webhooks', teamKey] as const,
  allTeamsWebhooks: ['webhooks', 'all-teams'] as const,
  webhookDeliveries: (webhookId: string) => ['webhookDeliveries', webhookId] as const,
  // A team's members (the Members section), and the workspace's users and pending
  // invites (the workspace Members page).
  members: (teamKey: string) => ['members', teamKey] as const,
  workspaceUsers: ['workspaceUsers'] as const,
  invites: ['invites'] as const,
  issue: (id: string) => ['issue', id] as const,
  anyIssue: ['issue'] as const,
  // Resolving an issue by its team-scoped number (the identifier-based URL).
  issueBySeq: (teamKey: string, seq: number) => ['issueBySeq', teamKey, seq] as const,
  feed: (id: string) => ['feed', id] as const,
  // The status stretches of the timeline view, and the entries of one stretch read
  // when it is opened. Both keyed under the feed, so every existing feed
  // invalidation refreshes them too.
  timeline: (id: string) => ['feed', id, 'timeline'] as const,
  timelineItems: (id: string, from: string, to: string | null) =>
    ['feed', id, 'timelineItems', from, to] as const,
  // Projects: a team's list (params narrow, sort and page it), the per-status
  // tab counts, one project, and one project's activity feed.
  projects: (teamKey: string, params?: Record<string, unknown>) =>
    ['projects', teamKey, params ?? {}] as const,
  projectsForTeam: (teamKey: string) => ['projects', teamKey] as const,
  projectCounts: (teamKey: string) => ['projectCounts', teamKey] as const,
  project: (id: string) => ['project', id] as const,
  projectFeed: (id: string) => ['projectFeed', id] as const,
  // Prefix keys: issue mutations invalidate every project query without
  // knowing the id (see invalidateProjects in issues.service).
  anyProject: ['project'] as const,
  anyProjectFeed: ['projectFeed'] as const,
  anyProjects: ['projects'] as const,
  attachments: (id: string) => ['attachments', id] as const,
  // A team's inbox notifications (the list, scoped by the active filters) and the
  // team's unread count (the sidebar badge + live-refresh target).
  notifications: (teamKey: string, filters?: unknown) =>
    ['notifications', teamKey, filters ?? {}] as const,
  notificationsUnread: (teamKey: string) => ['notificationsUnread', teamKey] as const,
  // The signed-in user's WebAuthn passkeys (account security page).
  passkeys: ['passkeys'] as const,
  // The signed-in user's connected external accounts (accounts page): the auth
  // providers better-auth reports.
  linkedAccounts: ['linkedAccounts'] as const,
  // The instance sign-in policy, including which social providers are configured.
  authConfig: ['authConfig'] as const,
  // The signed-in user's personal API keys (API keys page).
  apiKeys: ['apiKeys'] as const,
  // The signed-in user's interface preferences (timezone, theme, issue open mode,
  // start page). Read app-wide, not just on the preferences page.
  accountPreferences: ['accountPreferences'] as const,
  // The upload limits as read by the upload UI (open to any signed-in user).
  storageSettings: ['storageSettings'] as const,
  // The running version (any signed-in user).
  appVersion: ['appVersion'] as const,
  // The workspace settings (Linear's Organization).
  organization: ['organization'] as const,
};
