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
  // Team membership, invite links, and custom roles (the Members section). The
  // permission catalog is app-static, so it is not team-scoped.
  members: (teamKey: string) => ['members', teamKey] as const,
  invites: (teamKey: string) => ['invites', teamKey] as const,
  roles: (teamKey: string) => ['roles', teamKey] as const,
  permissionCatalog: ['permissionCatalog'] as const,
  // A team's AI agents (the AI Agents settings section). The tool catalog is
  // team-scoped on the API, so it hangs off the same key with an 'tools' tail.
  aiAgents: (teamKey: string) => ['aiAgents', teamKey] as const,
  agentTools: (teamKey: string) => ['aiAgents', teamKey, 'tools'] as const,
  // The skills enabled on one agent (the agent editor's Skills tab).
  agentSkillLinks: (teamKey: string, agentId: string) =>
    ['aiAgents', teamKey, agentId, 'skills'] as const,
  // An agent's triggered run history (the runs sidebar).
  agentRuns: (teamKey: string, agentId: string) => ['aiAgents', teamKey, agentId, 'runs'] as const,
  agentSchedules: (teamKey: string) => ['agentSchedules', teamKey] as const,
  agentScheduleRuns: (teamKey: string, scheduleId: string) =>
    ['agentSchedules', teamKey, scheduleId, 'runs'] as const,
  // The caller's chat threads with one agent (the AI Chat history rail) and the
  // transcript of one thread (restored when a thread is opened).
  agentThreads: (teamKey: string, agentId: string) =>
    ['aiAgents', teamKey, agentId, 'threads'] as const,
  agentThreadMessages: (teamKey: string, agentId: string, threadId: string) =>
    ['aiAgents', teamKey, agentId, 'threads', threadId] as const,
  // Stored integration credentials, the integration catalog, and an LLM provider's
  // models (the Integrations page and the agent model select).
  integrationCredentials: (teamKey: string) => ['integrations', teamKey] as const,
  integrationCatalog: (teamKey: string) => ['integrations', teamKey, 'catalog'] as const,
  integrationModels: (teamKey: string, provider: string) =>
    ['integrations', teamKey, 'models', provider] as const,
  // The team skill library (the Skills page).
  agentSkills: (teamKey: string) => ['agentSkills', teamKey] as const,
  // Configured tools (the Tools page) and the tools enabled on one agent (the agent
  // editor's Tools section).
  configuredTools: (teamKey: string) => ['configuredTools', teamKey] as const,
  agentToolLinks: (teamKey: string, agentId: string) =>
    ['aiAgents', teamKey, agentId, 'tool-configs'] as const,
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
  // Instance administration (god mode): the sign-in policy, the mail provider, the
  // Google credentials. Not scoped to a team.
  instanceAuthSettings: ['instanceAuthSettings'] as const,
  instanceEmailSettings: ['instanceEmailSettings'] as const,
  instanceGoogleSettings: ['instanceGoogleSettings'] as const,
  instanceStorageSettings: ['instanceStorageSettings'] as const,
  // The upload limits as read by the upload UI (open to any signed-in user).
  storageSettings: ['storageSettings'] as const,
  // The running version (any signed-in user) and the upstream release check (god).
  appVersion: ['appVersion'] as const,
  updateStatus: ['updateStatus'] as const,
  // The bindings every client resolves from, and the god-mode editor's copy.
  hotkeySettings: ['hotkeySettings'] as const,
  instanceHotkeySettings: ['hotkeySettings', 'god'] as const,
  // The instance user directory: the list (scoped by the active filters) and one
  // account with its team access.
  instanceUsers: (filters: unknown) => ['instanceUsers', filters] as const,
  instanceUser: (userId: string) => ['instanceUser', userId] as const,
  anyInstanceUsers: ['instanceUsers'] as const,
  // The instance team directory: the list (scoped by the active filters) and one
  // team with its members.
  instanceTeams: (filters: unknown) => ['instanceTeams', filters] as const,
  instanceTeam: (teamId: string) => ['instanceTeam', teamId] as const,
};
