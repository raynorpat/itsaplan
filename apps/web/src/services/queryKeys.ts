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
  // The viewer's display preferences for one list kind (allIssues, project, cycle,
  // myIssues).
  listPreferences: (viewType: string) => ['listPreferences', viewType] as const,
  // The completed issues an Insights panel reads for a view and period, keyed by the
  // view's settings key, its filter and the period's first day.
  insightsCompleted: (viewKey: string, filter: string, since: string) =>
    ['insightsCompleted', viewKey, filter, since] as const,
  insightsOpen: (viewKey: string, filter: string) => ['insightsOpen', viewKey, filter] as const,
  dashboards: ['dashboards'] as const,
  // The viewer's favorites (the sidebar's Favorites section and the page stars).
  favorites: ['favorites'] as const,
  dashboard: (id: string) => ['dashboard', id] as const,
  feedbackDashboard: ['dashboards', 'feedback-report'] as const,
  labelChoices: ['dashboards', 'label-choices'] as const,
  dashboardRows: (loadKey: string) => ['dashboardRows', loadKey] as const,
  dashboardFirstFeedback: (since: string) => ['dashboardFirstFeedback', since] as const,
  webhooks: (teamKey: string) => ['webhooks', teamKey] as const,
  allTeamsWebhooks: ['webhooks', 'all-teams'] as const,
  // A team's workflow automation rules, archived ones included (team settings →
  // Automations).
  automations: (teamId: string) => ['automations', teamId] as const,
  automation: (id: string) => ['automation', id] as const,
  // A cycle an automation action points at, looked up by id.
  automationCycle: (id: string) => ['automation-cycle', id] as const,
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
  sharedProjectUpdates: (projectId: string) => ['sharedProjectUpdates', projectId] as const,
  projectDocuments: (id: string) => ['projectDocuments', id] as const,
  projectLabels: ['projectLabels'] as const,
  // The workspace labels and groups (labels without a team), retired ones included.
  workspaceLabels: ['workspaceLabels'] as const,
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
  // Release tracking: a team's pipelines, one pipeline, one release, an issue's releases.
  releasePipelines: (teamId: string) => ['releasePipelines', teamId] as const,
  releasePipeline: (idOrSlug: string) => ['releasePipelines', 'one', idOrSlug] as const,
  anyReleasePipelines: ['releasePipelines'] as const,
  release: (idOrSlug: string) => ['releases', idOrSlug] as const,
  teamOpenReleases: (teamId: string) => ['releases', 'open', teamId] as const,
  anyReleases: ['releases'] as const,
  issueReleases: (issueId: string) => ['issueReleases', issueId] as const,
  anyIssueReleases: ['issueReleases'] as const,
  attachments: (id: string) => ['attachments', id] as const,
  issueRelations: (id: string) => ['issueRelations', id] as const,
  // An issue's parent and sub-issues; issue writes refresh every entry by the prefix.
  issueFamily: (id: string) => ['issueFamily', id] as const,
  anyIssueFamily: ['issueFamily'] as const,
  // Feedback: one issue's, one project's (on its issues), and the requester search.
  issueFeedback: (id: string) => ['feedback', 'issue', id] as const,
  issueFeedbackCount: (id: string) => ['feedback', 'count', id] as const,
  projectFeedback: (id: string) => ['feedback', 'project', id] as const,
  anyFeedback: ['feedback'] as const,
  anyProjectFeedback: ['feedback', 'project'] as const,
  requesterSearch: (q: string) => ['requesters', 'search', q] as const,
  // The People pages: the list (by search) and one person.
  requesterList: (q: string) => ['requesters', 'list', q] as const,
  requester: (id: string) => ['requesters', 'person', id] as const,
  anyRequesters: ['requesters'] as const,
  // Feedback summaries per issue: a team board's, and an Insights panel's scope.
  teamRequests: (teamKey: string) => ['requests', 'team', teamKey] as const,
  issueOrderRanks: (teamKey: string, field: string, dir: string, version: string) =>
    ['issues', 'orderRanks', teamKey, field, dir, version] as const,
  anyIssueOrderRanks: ['issues', 'orderRanks'] as const,
  insightsRequests: (viewKey: string, scope: string) =>
    ['requests', 'insights', viewKey, scope] as const,
  anyRequests: ['requests'] as const,
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
  imports: ['imports'] as const,
  // Portal boards (Settings → Workspace → Portal) and the boards showing an issue.
  portalBoards: ['portal', 'boards'] as const,
  issuePortalBoards: (issueId: string) => ['portal', 'issue', issueId] as const,
  // The AI endpoint for summaries (Settings → Workspace → AI, owners and admins).
  aiSettings: ['aiSettings'] as const,
  // Customers: the settings (switch and currency), statuses, tiers, the list and one
  // customer by id or slug.
  customersSettings: ['customers', 'settings'] as const,
  customerPeopleCounts: ['customers', 'people-counts'] as const,
  customerStatuses: ['customers', 'statuses'] as const,
  customerTiers: ['customers', 'tiers'] as const,
  customerList: (filter: string) => ['customers', 'list', filter] as const,
  customer: (idOrSlug: string) => ['customers', 'one', idOrSlug] as const,
  anyCustomers: ['customers'] as const,
  importPeople: (id: string) => ['imports', 'people', id] as const,
  githubImport: ['githubImport'] as const,
  githubImportRepositories: ['githubImport', 'repositories'] as const,
  oauthAuthorized: ['oauthAuthorized'] as const,
  accountEmails: ['accountEmails'] as const,
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
  myIssues: (tab: string, includeCompleted: boolean, mode: string) =>
    ['myIssues', tab, includeCompleted, mode] as const,
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
  qk.anyProjectFeedback,
];

// An issue leaving or rejoining the active issues (delete, archive, restore) also
// changes the feedback request counts, which read active issues only. Feedback writes
// refresh them on their own (feedback.service.ts); ordinary issue edits leave them.
export const ISSUE_REMOVAL_KEYS: readonly (readonly unknown[])[] = [
  ...ISSUE_DEPENDENT_KEYS,
  qk.anyRequests,
];
