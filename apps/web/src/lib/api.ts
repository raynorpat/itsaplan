// Typed client for the planner API (apps/api/src/planner). Row shapes mirror the
// store DTOs. The API is a separate service; the browser reaches it at
// NEXT_PUBLIC_API_URL. The planner routes require a better-auth session, so every
// request sends credentials (the session cookie).

import type { FilterSet } from '@/utils/filters';
import type { SavedViewDisplay } from '@/utils/viewSettings';

// NEXT_PUBLIC_* is inlined at build time, so a build without it ships a client
// that cannot reach the API. Fail at import instead of pointing at a wrong origin.
export const API_URL = process.env.NEXT_PUBLIC_API_URL as string;
if (!API_URL) throw new Error('NEXT_PUBLIC_API_URL is not set');

// Resolves a possibly-relative API path (e.g. a stored avatar/attachment URL) to
// an absolute one against the API origin. Leaves absolute URLs untouched.
export function resolveApiUrl(url: string): string {
  return url.startsWith('http') ? url : `${API_URL}${url}`;
}

// An error carrying the HTTP status so callers can tell apart 401 (no session),
// 403 (no access to the team / not owner), 404 (not found) and 400 (a
// validation or business-rule failure). `message` is the API's `{ error }` text
// when present, so existing consumers that read `error.message` keep working.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Send the better-auth session cookie to the API (separate origin).
    credentials: 'include',
    // Never serve API reads from the HTTP cache — React Query owns caching, and a
    // browser-cached GET can return stale data after a mutation refetch.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Team {
  id: string;
  key: string;
  name: string;
  description: string;
  // Linear's team visibility: a public team is open to every owner, admin and
  // member of the workspace; a private one to its members only.
  visibility: TeamVisibility;
  createdAt: string;
  // The caller's membership in this team, only on the /teams list: 'owner' (a
  // team owner), 'member', or null for a public team they have not joined.
  role?: MemberRole | null;
  // Whether the caller manages the team (team owner, workspace admin or owner, or
  // any member of a team without owners). Only on the /teams list.
  canManage?: boolean;
}

export type TeamVisibility = 'public' | 'private';

// Linear's workspace roles. Owners and admins administer the workspace; guests
// reach only the teams they were added to.
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface Column {
  id: string;
  teamId: string;
  name: string;
  stateType: StateType;
  color: string;
  description: string;
  position: number;
  archivedAt: string | null;
}

export interface Label {
  id: string;
  // Null for a workspace label (shared by every team; managed over the API).
  teamId: string | null;
  // The group this label belongs to, or null when ungrouped.
  groupId: string | null;
  name: string;
  color: string;
  // Set when the label is retired: it stays on issues but is not offered.
  retiredAt: string | null;
}

// A container a label can belong to. Labels reference it by groupId.
export interface LabelGroup {
  id: string;
  teamId: string | null;
  name: string;
  color: string;
}

export interface Assignee {
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Issue {
  id: string;
  teamId: string;
  // Team-scoped sequence number (the "42" in "MKT-42"). Addresses the issue by
  // its human number in URLs (/team/MKT/issue/42).
  sequenceNumber: number;
  identifier: string;
  // The project this issue is linked to, expanded to id + title for rendering,
  // or null. Set through updateIssue by projectId.
  project: ProjectOption | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  stateId: string;
  // Parent issue id (sub-issues), or null for a top-level issue.
  parentId: string | null;
  projectMilestoneId: string | null;
  // The team cycle the issue belongs to (managed over the API for now).
  cycleId: string | null;
  creatorUserId: string | null;
  title: string;
  description: string;
  // Linear's scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  position: number;
  // Status timestamps, kept in step with the column type by the API.
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  // When the issue was archived (hidden from the board but kept), or null when it
  // is active. Set by the archive action or the worker's auto-archive sweep.
  archivedAt: string | null;
  labelIds: string[];
}

// A light search result from GET /teams/:key/issues/search: enough to list and
// open a match, without the full issue's description.
export interface IssueSearchHit {
  id: string;
  sequenceNumber: number;
  identifier: string;
  title: string;
  stateId: string;
  projectId: string | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  priority: number;
  dueDate: string | null;
  labelIds: string[];
  archived: boolean;
}

// The auto-archive periods a team may pick (Linear's Team.autoArchivePeriod): months
// a completed or canceled issue stays before the worker archives it; 0 = off.
export const AUTO_ARCHIVE_PERIODS = [0, 1, 3, 6, 9, 12] as const;

// A team's settings: the auto-archive period in months.
export interface TeamSettings {
  autoArchivePeriod: number;
}

// Email on or off per Linear notification category.
export interface EmailCategories {
  assignments: boolean;
  mentions: boolean;
  commentsAndReplies: boolean;
  statusChanges: boolean;
}

// ── Storage limits ────────────────────────────────────────────────────────────

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

// ── Workspace settings (Linear's Organization) ────────────────────────────────

// The minimum workspace role for an action.
export type MinimumRole = 'owner' | 'admin' | 'member';

// The workspace settings. Readable by any signed-in user; changed by owners and
// admins. approvedDomains (from the environment) and version are read-only.
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
  version: string;
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

// The sign-in methods the sign-in screen offers, readable without a session. The
// email (magic link) field is always offered.
export interface PublicAuthConfig {
  emailEnabled: boolean;
  google: boolean;
  passkey: boolean;
}

// The signed-in user's email notification preferences for the whole workspace, per
// Linear notification category. Email is sent to the account address.
export interface NotificationPreferences {
  emailCategories: EmailCategories;
}

// The signed-in user's interface preferences. timezone is an IANA zone name the app
// renders stored UTC timestamps in, saved on the account (Linear's User.timezone);
// the rest are kept in this browser (services/preferences.service.ts).
// issueOpenMode decides whether a clicked issue opens in the side panel or on its
// own page; startPage is the section the app root lands on; lastTeamId is the team
// the app root reopens (null until the user has opened one).
export type ThemePreference = 'light' | 'dark' | 'system';
export type IssueOpenMode = 'panel' | 'page';
export type StartPage = 'inbox' | 'work-items' | 'projects';
export type IssueStatsView = 'compact' | 'timeline';

export interface AccountPreferences {
  timezone: string;
  theme: ThemePreference;
  issueOpenMode: IssueOpenMode;
  startPage: StartPage;
  // How the status stats section of an issue starts out: expanded or collapsed, and
  // in the compact bar or the full timeline. Switching it on an issue is not saved —
  // it lasts as long as that issue stays open.
  issueStatsOpen: boolean;
  issueStatsView: IssueStatsView;
  lastTeamId: string | null;
  // The keyboard shortcuts this user rebound, as { commandId: combo }. Only the
  // changed ones; the rest are the built-in bindings (see lib/hotkeys).
  hotkeys: HotkeyOverrides;
}

// Rebound keyboard shortcuts: the combination each overridden command id takes. A
// command left out keeps the binding from the layer below.
export type HotkeyOverrides = Record<string, string>;

export type AccountPreferencesPatch = Partial<AccountPreferences>;

// A saved view (a tab above the work items view): a named filter set plus a display
// snapshot (layout + that layout's settings). The API stores the filter as Linear's
// IssueFilter (`filterData`) and the display as the view's organization view
// preferences; the client converts the filter to and from the filter bar's set.
export interface View {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  filters: FilterSet;
  display: SavedViewDisplay;
  createdAt: string;
}

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

export const WEBHOOK_RESOURCE_TYPES: { value: WebhookResourceType; label: string }[] = [
  { value: 'Issue', label: 'Issues' },
  { value: 'Comment', label: 'Comments' },
  { value: 'IssueLabel', label: 'Issue labels' },
  { value: 'Project', label: 'Projects' },
  { value: 'ProjectUpdate', label: 'Project updates' },
  { value: 'Reaction', label: 'Reactions' },
  { value: 'Cycle', label: 'Cycles' },
  { value: 'Initiative', label: 'Initiatives' },
  { value: 'InitiativeUpdate', label: 'Initiative updates' },
  { value: 'Document', label: 'Documents' },
  { value: 'Attachment', label: 'Attachments' },
];

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

export interface NewWebhookInput {
  url: string;
  resourceTypes: WebhookResourceType[];
  label?: string | null;
  enabled?: boolean;
}

export interface WebhookPatch {
  url?: string;
  resourceTypes?: WebhookResourceType[];
  label?: string | null;
  enabled?: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  // Absolute, no-auth URL — usable directly in <img>/<video> and in markdown.
  url: string;
}

// `action` selects how the UI renders an activity row; from_text/to_text are
// display-ready value snapshots (column/label/assignee name, raw priority, ISO
// date, or the new text of a long field). `subject` names the changed sub-item
// where the action alone is not enough (the relation type for 'relation').
export type ActivityAction =
  | 'created'
  | 'title'
  | 'description'
  | 'status'
  | 'assignee'
  | 'delegate'
  | 'priority'
  | 'due_date'
  | 'label_add'
  | 'label_remove'
  | 'archived'
  | 'restored'
  | 'relation'
  | 'project'
  | 'cycle';

// One entry in an issue's timeline. kind selects which payload fields are set:
// a 'comment' carries body; an 'activity' carries action/subject/fromText/toText.
// actorName is the author/actor snapshot (null when it was never set).
export interface FeedItem {
  id: string;
  issueId: string;
  kind: 'comment' | 'activity';
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: ActivityAction | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  // Comments only: the thread root of a reply, and when the comment was last edited.
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  // Comments read over GraphQL: their reactions. Absent on REST feed rows.
  reactions?: { id: string; emoji: string; user: { id: string; name: string } | null }[];
}

// Opaque keyset cursor returned by the project feed endpoint; pass it back to load
// the next (older) page.
export interface FeedCursor {
  ts: string;
  id: string;
}

// One stretch the issue spent in a single state, from Linear's Issue.stateHistory.
// `status` is the state's name (null when the state was deleted since); `to` is null
// for the stretch the issue is in now.
export interface TimelineSegment {
  status: string | null;
  from: string;
  to: string | null;
  durationMs: number;
}

// The caller's access to a team, returned with it: their membership (null for a
// public team they have not joined), their workspace role, and whether they
// manage the team. See usePermissions.
export interface TeamViewer {
  role: MemberRole | null;
  workspaceRole: WorkspaceRole;
  canManage: boolean;
}

export interface ProjectOption {
  id: string;
  title: string;
}

// The board scaffold, returned by getTeam: everything the work-items UI needs
// except the issues themselves (those come from getBoardIssues).
export interface TeamScaffold {
  team: Team;
  states: Column[];
  labels: Label[];
  labelGroups: LabelGroup[];
  assignees: Assignee[];
  viewer: TeamViewer;
}

// The board's issues, returned by getBoardIssues and refetched on an interval.
export interface BoardIssues {
  issues: Issue[];
}

// The scaffold composed with its issues, as the Shell assembles it and passes it
// down. Downstream reads team.issues off this composite.
export type TeamDetail = TeamScaffold & BoardIssues;

export type IssueDetail = Issue;

export interface NewIssueInput {
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  stateId: string;
  title: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
  labelIds?: string[];
}

// The fields a bulk update can set on many issues at once (the board-relevant
// subset of IssuePatch: no title/description/position).
export interface BulkIssuePatch {
  stateId?: string;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  priority?: number;
  dueDate?: string | null;
}

export interface IssuePatch {
  stateId?: string;
  position?: number;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  title?: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
  labelIds?: string[];
}

// --- Projects -----------------------------------------------------------------
// A project (Linear's Project) across one or more teams. progress is derived
// server-side from the linked issues' states.

// A project status type (Linear's six project status types).
export type ProjectStatus = 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled';
export type ProjectHealth = 'onTrack' | 'atRisk' | 'offTrack';

export interface ProjectProgress {
  completed: number;
  canceled: number;
  total: number;
}

export interface Project {
  id: string;
  // The project's teams the viewer can access.
  teams: { id: string; key: string; name: string }[];
  name: string;
  // Short plain-text summary.
  description: string;
  // Markdown overview.
  content: string;
  status: ProjectStatus;
  statusId: string;
  leadUserId: string | null;
  // Linear's scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  priority: number;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  slugId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
  progress: ProjectProgress;
  // The latest project update's health, or null when there is no update.
  health: ProjectHealth | null;
  // Linear's scope: the project's open (not canceled) issues. Read over GraphQL.
  scope?: number;
}

// Columns the project list can be sorted by (in the browser, over the loaded rows).
// progress and health are derived and not sortable.
export const PROJECT_SORTS = ['name', 'priority', 'targetDate', 'lead'] as const;

export type ProjectSort = (typeof PROJECT_SORTS)[number];

// A project milestone (read-only in the web app; edited over GraphQL).
export interface ProjectMilestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  sortOrder: number;
}

// A workspace-level project label; a group holds labels and cannot be applied.
export interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parentId: string | null;
  isGroup: boolean;
}

// Per-status project counts for the list's status tabs.
export type ProjectCounts = Record<ProjectStatus | 'total', number>;

export interface NewProjectInput {
  name: string;
  description?: string;
  content?: string;
  status?: ProjectStatus;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  content?: string;
  status?: ProjectStatus;
  leadUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
}

// One entry in an project's feed: an event of the project itself (source
// 'project') or the activity of a linked issue (source 'issue', carrying the
// issue's id and identifier so the row can link to it).
export interface ProjectFeedItem {
  id: string;
  source: 'project' | 'issue';
  kind: 'comment' | 'activity';
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: string | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  createdAt: string;
  issueId: string | null;
  issueIdentifier: string | null;
}

export interface ProjectFeedPage {
  items: ProjectFeedItem[];
  nextCursor: FeedCursor | null;
}

// Team membership: 'owner' marks a team owner, who manages the team's settings
// with the workspace admins.
export type MemberRole = 'owner' | 'member';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  createdAt: string;
}

// A user of the workspace, as owners and admins manage them.
export interface WorkspaceUser {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  // Set while the user is suspended (Linear's way to remove someone).
  suspendedAt: string | null;
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

// An invite as shown to the invitee opening the link (no sign-in needed).
export interface InviteView {
  token: string;
  email: string;
  role: InviteRole;
  teamNames: string[];
  invitedByName: string | null;
  expiresAt: string;
}

// Inbox notifications. Each row is enriched with the issue and team it points at
// so the list renders without extra calls.
export type NotificationType = 'assigned' | 'mentioned' | 'commented' | 'state_changed';

export interface Notification {
  id: string;
  type: NotificationType;
  actorUserId: string | null;
  actorName: string | null;
  readAt: string | null;
  snoozedUntil: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  issueId: string;
  issueSeq: number;
  issueTitle: string;
  issueStateType: StateType;
  teamId: string;
  teamKey: string;
  teamName: string;
}

export const api = {
  // The teams the caller can see: joined teams plus public teams not joined
  // (role null).
  listTeams: () => request<Team[]>('/teams'),
  createTeam: (input: {
    key: string;
    name: string;
    description?: string;
    visibility?: TeamVisibility;
  }) => request<Team>('/teams', { method: 'POST', body: JSON.stringify(input) }),
  // Update a team's name, description or visibility. The key is immutable.
  updateTeam: (
    teamKey: string,
    patch: { name?: string; description?: string; visibility?: TeamVisibility },
  ) => request<Team>(`/teams/${teamKey}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTeam: (teamKey: string) => request<void>(`/teams/${teamKey}`, { method: 'DELETE' }),

  createState: (teamKey: string, input: { name: string; stateType: StateType; color?: string }) =>
    request<Column>(`/teams/${teamKey}/columns`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateState: (teamKey: string, stateId: string, patch: { name?: string; color?: string }) =>
    request<Column>(`/teams/${teamKey}/columns/${stateId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  reorderStates: (teamKey: string, orderedIds: string[]) =>
    request<Column[]>(`/teams/${teamKey}/columns/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
  deleteState: (
    teamKey: string,
    stateId: string,
    body: { mode: 'move'; targetStateId: string } | { mode: 'delete' },
  ) =>
    request<void>(`/teams/${teamKey}/columns/${stateId}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),

  createLabel: (
    teamKey: string,
    input: { name: string; color?: string; groupId?: string | null },
  ) =>
    request<Label>(`/teams/${teamKey}/labels`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLabel: (
    teamKey: string,
    labelId: string,
    patch: { name?: string; color?: string; groupId?: string | null },
  ) =>
    request<Label>(`/teams/${teamKey}/labels/${labelId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteLabel: (teamKey: string, labelId: string) =>
    request<void>(`/teams/${teamKey}/labels/${labelId}`, { method: 'DELETE' }),

  createLabelGroup: (teamKey: string, input: { name: string; color?: string }) =>
    request<LabelGroup>(`/teams/${teamKey}/label-groups`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLabelGroup: (teamKey: string, groupId: string, patch: { name?: string; color?: string }) =>
    request<LabelGroup>(`/teams/${teamKey}/label-groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteLabelGroup: (teamKey: string, groupId: string) =>
    request<void>(`/teams/${teamKey}/label-groups/${groupId}`, { method: 'DELETE' }),

  // Server-side text search for the command palette. Always returns all matches,
  // archived included (each hit carries an `archived` flag).
  searchIssues: (teamKey: string, params: { q?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit != null) qs.set('limit', String(params.limit));
    return request<IssueSearchHit[]>(`/teams/${teamKey}/issues/search?${qs.toString()}`);
  },

  // Projects span teams: the list and counts take an optional team filter, create
  // takes the team ids, and ops on one project take its id.
  setProjectTeams: (id: string, teamIds: string[]) =>
    request<Project>(`/projects/${id}/teams`, {
      method: 'PUT',
      body: JSON.stringify({ teamIds }),
    }),
  listProjectLabels: () => request<ProjectLabel[]>('/project-labels'),
  createProjectLabel: (input: { name: string; color?: string }) =>
    request<ProjectLabel>('/project-labels', { method: 'POST', body: JSON.stringify(input) }),
  updateProjectLabel: (id: string, patch: { name?: string; color?: string }) =>
    request<ProjectLabel>(`/project-labels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProjectLabel: (id: string) => request<void>(`/project-labels/${id}`, { method: 'DELETE' }),
  createProject: (input: NewProjectInput & { teamIds: string[] }) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProject: (id: string, patch: ProjectPatch) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  // Cheap change marker for an project's detail + feed — polled for live refresh.
  listProjectFeed: (id: string, params: { cursor?: FeedCursor | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', JSON.stringify(params.cursor));
    const qs = q.toString();
    return request<ProjectFeedPage>(`/projects/${id}/feed${qs ? `?${qs}` : ''}`);
  },

  // Team members. Anyone who can see a team may join it (not guests); any member
  // may add people to a public team, a team manager to a private one; a member
  // may always leave (remove themselves).
  listMembers: (teamKey: string) => request<MemberRow[]>(`/teams/${teamKey}/members`),
  joinTeam: (teamKey: string) =>
    request<{ teamKey: string; userId: string }>(`/teams/${teamKey}/join`, { method: 'POST' }),
  addMember: (teamKey: string, input: { userId: string; owner?: boolean }) =>
    request<{ teamKey: string; userId: string }>(`/teams/${teamKey}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeMember: (teamKey: string, userId: string) =>
    request<void>(`/teams/${teamKey}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  // Make a member a team owner or a plain member (team managers).
  setMemberRole: (teamKey: string, userId: string, role: MemberRole) =>
    request<void>(`/teams/${teamKey}/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  // Workspace users (owners, admins and members list; owners and admins change).
  listWorkspaceUsers: () => request<WorkspaceUser[]>('/workspace/users'),
  setWorkspaceRole: (userId: string, role: WorkspaceRole) =>
    request<WorkspaceUser>(`/workspace/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  suspendUser: (userId: string) =>
    request<void>(`/workspace/users/${encodeURIComponent(userId)}/suspend`, {
      method: 'POST',
    }),
  unsuspendUser: (userId: string) =>
    request<void>(`/workspace/users/${encodeURIComponent(userId)}/unsuspend`, {
      method: 'POST',
    }),

  // Workspace invites. Owners, admins and members invite (never above their own
  // role); the sender or an admin revokes. The invitee reads one by its token
  // without signing in, then signs up with the invited email.
  listInvites: () => request<InviteRow[]>('/invites'),
  createInvite: (input: { email: string; role: InviteRole; teamIds?: string[] }) =>
    request<InviteRow>('/invites', { method: 'POST', body: JSON.stringify(input) }),
  deleteInvite: (inviteId: string) =>
    request<void>(`/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
  getInvite: (token: string) => request<InviteView>(`/invites/${encodeURIComponent(token)}`),

  listWebhooks: (teamKey: string) => request<Webhook[]>(`/teams/${teamKey}/webhooks`),
  createWebhook: (teamKey: string, input: NewWebhookInput) =>
    request<Webhook>(`/teams/${teamKey}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWebhook: (webhookId: string, patch: WebhookPatch) =>
    request<Webhook>(`/webhooks/${webhookId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteWebhook: (webhookId: string) =>
    request<void>(`/webhooks/${webhookId}`, { method: 'DELETE' }),
  rotateWebhookSecret: (webhookId: string) =>
    request<Webhook>(`/webhooks/${webhookId}/rotate-secret`, { method: 'POST' }),
  // All-teams webhooks: workspace owners and admins (403 otherwise).
  listAllTeamsWebhooks: () => request<Webhook[]>('/webhooks'),
  createAllTeamsWebhook: (input: NewWebhookInput) =>
    request<Webhook>('/webhooks', { method: 'POST', body: JSON.stringify(input) }),

  // Team settings: the auto-archive period. Anyone who can see the team reads; team
  // managers write. The PATCH takes only the fields being changed.
  getTeamSettings: (teamKey: string) => request<TeamSettings>(`/teams/${teamKey}/settings`),
  updateTeamSettings: (
    teamKey: string,
    patch: {
      autoArchivePeriod?: number;
    },
  ) =>
    request<TeamSettings>(`/teams/${teamKey}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // The signed-in user's own email notification preferences, for the whole workspace.
  getNotificationPreferences: () =>
    request<NotificationPreferences>('/account/notification-preferences'),
  setNotificationPreferences: (input: NotificationPreferences) =>
    request<NotificationPreferences>('/account/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  // The session user's own interface preferences, held per account. A read returns
  // the defaults when nothing was saved; a write patches only the fields it carries.
  // The account's time zone; the other preferences are kept in the browser.
  getAccountTimezone: () => request<{ timezone: string }>('/account/preferences'),
  updateAccountTimezone: (timezone: string) =>
    request<{ timezone: string }>('/account/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    }),

  // The upload limits, read by the upload UI before a file is picked.
  getStorageSettings: () => request<StorageSettings>('/settings/storage'),

  // The running version, shown in the sidebar and in workspace settings.
  getAppVersion: () => request<{ version: string }>('/settings/version'),

  // The workspace settings: any signed-in user reads them, owners and admins change
  // them.
  getOrganization: () => request<OrganizationSettings>('/organization'),
  updateOrganization: (patch: OrganizationSettingsPatch) =>
    request<OrganizationSettings>('/organization', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // The sign-in methods offered, readable without a session: the sign-in screen
  // needs them before an account exists.
  getAuthConfig: () => request<PublicAuthConfig>('/auth-config'),
};
