// Query keys shared by every service. Each is a stable tuple; a team/issue id
// or key scopes its entry. Kept in one registry so a mutation in one service can
// invalidate another service's queries by the same key.
export const qk = {
  teams: ['teams'] as const,
  // The board scaffold (columns/types/labels/fields/viewer) for a team.
  team: (teamKey: string) => ['workItems', teamKey] as const,
  // The board's issues for a team (every active issue). Split from the scaffold so
  // issue writes and the changed-since refresh touch only the issues.
  boardIssues: (teamKey: string) => ['boardIssues', teamKey] as const,
  // The ids of a team's issues having one of a set of subscribers (the subscribers
  // filter), keyed by the sorted user ids.
  subscribedIssueIds: (teamKey: string, users: string) =>
    ['team', teamKey, 'subscribed-issue-ids', users] as const,
  // Command-palette issue search, scoped to a team and the search term.
  issueSearch: (teamKey: string, q: string) => ['issueSearch', teamKey, q] as const,
  teamSettings: (teamKey: string) => ['teamSettings', teamKey] as const,
  // A team's notification delivery settings (the Notifications section).
  notificationPreferences: () => ['notificationPreferences'] as const,
  views: (teamKey: string) => ['views', teamKey] as const,
  // Every saved view the viewer can see, across teams (the workspace Views page).
  allViews: () => ['allViews'] as const,
  webhooks: (teamKey: string) => ['webhooks', teamKey] as const,
  allTeamsWebhooks: ['webhooks', 'all-teams'] as const,
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
  // A document's comments, and an issue's documents and subscribers.
  documentComments: (id: string) => ['documentComments', id] as const,
  issueDocuments: (id: string) => ['issueDocuments', id] as const,
  issueSubscribers: (id: string) => ['issueSubscribers', id] as const,
  // The issue's own reactions, keyed under the feed so every existing feed
  // invalidation refreshes them too.
  issueReactions: (id: string) => ['feed', id, 'reactions'] as const,
  // An agent session on the issue, keyed under the feed so feed invalidations refresh it.
  agentSession: (issueId: string, sessionId: string) =>
    ['feed', issueId, 'agentSession', sessionId] as const,
  // Projects: a team's list (params narrow, sort and page it), the per-status
  // tab counts, one project, its activity (history, comments, updates) and its
  // updates with their comments.
  projects: (teamKey: string, params?: Record<string, unknown>) =>
    ['projects', teamKey, params ?? {}] as const,
  projectCounts: (teamKey: string) => ['projectCounts', teamKey] as const,
  project: (id: string) => ['project', id] as const,
  projectActivity: (id: string) => ['projectActivity', id] as const,
  projectUpdates: (id: string) => ['projectUpdates', id] as const,
  projectDocuments: (id: string) => ['projectDocuments', id] as const,
  projectLabels: ['projectLabels'] as const,
  // Prefix keys: issue mutations invalidate every project query without
  // knowing the id (see ISSUE_DEPENDENT_KEYS below).
  anyProject: ['project'] as const,
  anyProjects: ['projects'] as const,
  // Initiatives: the workspace's list, one initiative, its updates with their
  // comments, and the workspace's sub-initiative relations.
  initiatives: ['initiatives'] as const,
  initiative: (id: string) => ['initiative', id] as const,
  initiativeUpdates: (id: string) => ['initiativeUpdates', id] as const,
  initiativeRelations: ['initiativeRelations'] as const,
  // Cycles: a team's cycle lists ("open" is the current and upcoming ones, "past"
  // the paged past ones), one cycle by team and number, and a past cycle's archived
  // issues. Issue writes change a cycle's progress, so they invalidate the prefixes.
  cycles: (teamId: string, list: 'open' | 'past' | 'archived') => ['cycles', teamId, list] as const,
  cycle: (teamId: string, number: number) => ['cycle', teamId, number] as const,
  cycleArchivedIssues: (cycleId: string) => ['cycle', 'archived-issues', cycleId] as const,
  anyCycle: ['cycle'] as const,
  anyCycles: ['cycles'] as const,
  attachments: (id: string) => ['attachments', id] as const,
  issueRelations: (id: string) => ['issueRelations', id] as const,
  // An issue's parent and sub-issues; issue writes refresh every entry by the prefix.
  issueFamily: (id: string) => ['issueFamily', id] as const,
  anyIssueFamily: ['issueFamily'] as const,
  // The viewer's notifications for the whole workspace (the inbox and its badge).
  notifications: () => ['notifications'] as const,
  // The signed-in user's WebAuthn passkeys (account security page).
  passkeys: ['passkeys'] as const,
  // The signed-in user's connected external accounts (accounts page): the auth
  // providers better-auth reports.
  linkedAccounts: ['linkedAccounts'] as const,
  // The instance sign-in policy, including which social providers are configured.
  authConfig: ['authConfig'] as const,
  // The signed-in user's personal API keys (API keys page).
  apiKeys: ['apiKeys'] as const,
  // The workspace's OAuth applications (admins), the applications the signed-in
  // person has authorized, and the application a consent page shows.
  oauthApps: ['oauthApps'] as const,
  oauthAuthorized: ['oauthAuthorized'] as const,
  oauthClient: (clientId: string) => ['oauthClient', clientId] as const,
  // The signed-in user's interface preferences (timezone, theme, issue open mode,
  // start page). Read app-wide, not just on the preferences page.
  accountPreferences: ['accountPreferences'] as const,
  // The upload limits as read by the upload UI (open to any signed-in user).
  storageSettings: ['storageSettings'] as const,
  // The running version (any signed-in user).
  appVersion: ['appVersion'] as const,
  // The workspace settings (Linear's Organization).
  organization: ['organization'] as const,
  // The viewer's workspace role and the workspace's name and logo (the sidebar chrome).
  viewerWorkspace: ['viewerWorkspace'] as const,
  // My issues: one tab, with or without completed and canceled issues.
  myIssues: (tab: string, includeCompleted: boolean) =>
    ['myIssues', tab, includeCompleted] as const,
  anyMyIssues: ['myIssues'] as const,
};

// The queries an issue write can change beyond the issue and its team's board: its
// project's and cycle's progress and scope, a past cycle's archived issues, and the
// My issues lists. The mutations do not know which entries are affected, so they
// invalidate these prefixes; only active queries refetch.
export const ISSUE_DEPENDENT_KEYS: readonly (readonly unknown[])[] = [
  qk.anyProject,
  qk.anyProjects,
  qk.anyCycle,
  qk.anyCycles,
  qk.anyMyIssues,
  qk.anyIssueFamily,
];
