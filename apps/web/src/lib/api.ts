// Typed client for the planner API (apps/api/src/planner). Row shapes mirror the
// store DTOs. The API is a separate service; the browser reaches it at
// NEXT_PUBLIC_API_URL. The planner routes require a better-auth session, so every
// request sends credentials (the session cookie).

import type { FilterSet } from '@/utils/filters';
import type { SavedViewDisplay } from '@/utils/viewSettings';
import type { DashboardLayout, BreakdownBy } from '@/utils/dashboardWidgets';

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
  // Whether this team is reachable through the MCP server. Toggled by an owner
  // on the MCP page; gates every MCP tool call scoped to the team.
  mcpEnabled: boolean;
  // The optional sections, toggled by an owner in Settings -> General. Read through
  // useTeamFeatures, which hides the navigation and the section itself.
  projectsEnabled: boolean;
  dashboardsEnabled: boolean;
  notesEnabled: boolean;
  createdAt: string;
  // The caller's role in this team. Only present on the /teams list
  // response (used to gate owner-only actions like deletion); absent on the
  // create/copy responses.
  role?: MemberRole;
  // The caller's permission matrix in this team. Present only when the list is
  // requested with permissions (listTeams({ permissions: true })).
  permissions?: Permissions;
}

// Parts of a source team the copy can carry over, one key per team settings
// section. Passed to copyTeam as an include map; omitted keys are not copied. The
// API force-enables dependencies (a view needs its states/types/labels/fields).
export type CopyTeamIncludeKey =
  | 'states'
  | 'issueTypes'
  | 'labels'
  | 'customFields'
  | 'views'
  | 'dashboards'
  | 'actions'
  | 'archive'
  | 'roles'
  | 'notificationProviders'
  | 'webhooks'
  | 'integrations'
  | 'tools'
  | 'skills'
  | 'agents'
  | 'schedules';

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

export interface IssueType {
  id: string;
  teamId: string;
  name: string;
  icon: string;
  color: string;
  isDefault: boolean;
  position: number;
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
  kind: 'member' | 'agent';
  agentKind: 'external' | 'internal' | null;
}

// An AI agent on a team: a bot user plus its configuration. `kind` is
// 'external' (driven by an outside caller through the API) or 'internal' (run by
// the built-in runtime, so it carries provider/model/instructions/tools). Only an
// external agent has an API key: `apiKeyStart` is the non-secret prefix for display
// (null for internal), and the plaintext key is only returned once, on create and
// on regenerate.
export interface AiAgent {
  id: string;
  teamId: string;
  userId: string;
  name: string;
  username: string;
  kind: 'external' | 'internal';
  // The integration_credential (kind 'llm') the model runs on, or null.
  modelCredentialId: string | null;
  model: string | null;
  instructions: string | null;
  tools: string[];
  temperature: number | null;
  maxSteps: number | null;
  memoryEnabled: boolean;
  memoryLastMessages: number | null;
  // Internal-agent run triggers.
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
  // External-agent authorization role (a team_role id, or null for the default).
  roleId: string | null;
  createdAt: string;
  apiKeyStart: string | null;
  // The integration key of the model credential (the provider, e.g. "openai"), or
  // null when no credential is set.
  modelProvider: string | null;
  // How many actions the agent can take (always-on read-only plus granted mutating),
  // and how many skills and configured tools are enabled.
  actionCount: number;
  skillCount: number;
  toolCount: number;
}

// One row of an agent's autonomous run history. Issue-triggered runs reference an
// issue; scheduled and manual runs do not.
export interface AgentRun {
  id: string;
  status: 'pending' | 'success' | 'failed';
  trigger: 'mention' | 'delegation' | 'schedule' | 'manual';
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  prompt: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

export interface AgentRunPage {
  items: AgentRun[];
  nextCursor: string | null;
}

export interface AgentSchedule {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: 'UTC';
  status: 'active' | 'paused';
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: 'pending' | 'success' | 'failed' | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentScheduleInput {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  status?: 'active' | 'paused';
}

export interface AgentScheduleRun {
  id: string;
  status: 'pending' | 'success' | 'failed';
  trigger: 'schedule' | 'manual';
  prompt: string;
  attempts: number;
  lastError: string | null;
  output: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// One work-item tool from the server-side catalog. `key` is stored on the agent
// (grantable actions only); label/description are for the picker. `always` marks the
// read-only tools that are always granted and shown non-editable.
export interface AgentTool {
  key: string;
  label: string;
  description: string;
  always: boolean;
}

export interface NewAiAgentInput {
  name: string;
  username: string;
  kind: 'external' | 'internal';
  modelCredentialId?: string | null;
  model?: string | null;
  instructions?: string | null;
  tools?: string[];
  temperature?: number | null;
  maxSteps?: number | null;
  memoryEnabled?: boolean;
  memoryLastMessages?: number | null;
  triggerOnMention?: boolean;
  triggerOnAssign?: boolean;
  roleId?: string | null;
}

export interface AiAgentPatch {
  name?: string;
  username?: string;
  modelCredentialId?: string | null;
  model?: string | null;
  instructions?: string | null;
  tools?: string[];
  temperature?: number | null;
  maxSteps?: number | null;
  memoryEnabled?: boolean;
  memoryLastMessages?: number | null;
  triggerOnMention?: boolean;
  triggerOnAssign?: boolean;
  roleId?: string | null;
}

// A field of an integration's credential form (from the catalog). `type` "secret"
// marks a value stored encrypted and shown masked.
export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number' | 'boolean';
  required: boolean;
  placeholder?: string;
  help?: string;
}

// An integration the team can store a credential for (server-side catalog). `kind`
// 'llm' is an AI provider (its models an agent runs on, no tools); 'tool' is a tool
// integration whose `tools` are configured on a credential.
export interface IntegrationMeta {
  key: string;
  label: string;
  kind: 'llm' | 'tool';
  credentialSchema: ConfigField[];
  tools: { key: string; label: string; description: string; scopes?: string[] }[];
}

// A model an LLM provider offers, from the models.dev registry.
export interface ProviderModel {
  id: string;
  name: string;
}

// A stored integration credential. `redacted` mirrors the stored credential with
// secret fields masked; the real secrets are never returned.
export interface IntegrationCredential {
  id: string;
  teamId: string;
  integrationKey: string;
  label: string | null;
  redacted: Record<string, unknown>;
  createdAt: string;
}

export interface NewCredentialInput {
  integrationKey: string;
  label?: string | null;
  credential: Record<string, unknown>;
}

export interface CredentialPatch {
  label?: string | null;
  // Only the fields being changed. Secret fields left out keep their stored value.
  credential?: Record<string, unknown>;
}

// A reference file of a skill (metadata only).
export interface SkillRef {
  path: string;
  s3Key: string;
  size: number;
}

// A skill in the team library: a SKILL.md plus optional reference files, given
// to internal agents. Content lives in the object store; this is the metadata.
export interface AgentSkill {
  id: string;
  teamId: string;
  name: string;
  description: string;
  source: 'upload' | 'inline' | 'github';
  sourceUrl: string | null;
  files: SkillRef[];
  createdAt: string;
}

export interface NewSkillInput {
  source: 'upload' | 'inline' | 'github';
  name?: string | null;
  description?: string | null;
  markdown?: string;
  sourceUrl?: string | null;
}

export interface SkillPatch {
  name?: string;
  description?: string;
  markdown?: string;
}

// A skill found at a GitHub URL by the discover endpoint. `url` is a ready-to-import
// link for that single skill.
export interface GithubSkillCandidate {
  name: string;
  description: string;
  subpath: string;
  url: string;
}

// A configured tool: a catalog tool (toolKey) bound to an integration credential,
// enriched with the credential's integration and label for display. (Distinct from
// AgentTool, which is a built-in capability tool in the agent's Actions list.)
export interface ConfiguredTool {
  id: string;
  teamId: string;
  toolKey: string;
  credentialId: string;
  integrationKey: string;
  credentialLabel: string | null;
  createdAt: string;
}

export interface NewConfiguredToolInput {
  toolKey: string;
  credentialId: string;
}

// One event of a streamed agent run (mirrors the API's AgentRunEvent). `text` is a
// chunk of the answer to append; `tool-start`/`tool-end` report a capability the
// agent is using, so the UI can show what it is doing; `done` ends the run with the
// conversation thread id; `error` reports a failure that happened mid-run.
export type AgentRunEvent =
  | { type: 'text'; value: string }
  | { type: 'tool-start'; toolCallId: string; toolName: string }
  | { type: 'tool-end'; toolCallId: string; toolName: string }
  | { type: 'done'; threadId: string | null }
  | { type: 'error'; message: string };

// One of the caller's saved chat conversations with an agent. `title` is the first
// prompt (truncated); null when it was never set.
export interface AiChatThread {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// One restored message of a chat thread's transcript.
export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface AiChatMessagePage {
  items: AiChatMessage[];
  nextPage: number | null;
}

// Streams an internal agent's response over SSE, yielding each AgentRunEvent as it
// arrives. Sends the session cookie like every other call. Throws ApiError when the
// request itself fails before the stream starts (e.g. 403/404); a failure during
// the run arrives as an `error` event, not a throw.
export async function* streamAiAgentRun(
  teamKey: string,
  agentId: string,
  input: { prompt: string; threadId?: string | null },
): AsyncGenerator<AgentRunEvent> {
  const body = input.threadId
    ? { prompt: input.prompt, threadId: input.threadId }
    : { prompt: input.prompt };
  const res = await fetch(`${API_URL}/teams/${teamKey}/ai-agents/${agentId}/run/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null);
    throw new ApiError(res.status, err?.error ?? `${res.status} ${res.statusText}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    // SSE frames are separated by a blank line; each frame here is a single
    // `data:` line carrying one JSON-encoded event.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) yield JSON.parse(line.slice(5).trim()) as AgentRunEvent;
    }
  }
}

export type CustomFieldType =
  'text' | 'markdown' | 'url' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select';

export interface CustomFieldOption {
  id: string;
  value: string;
  color: string;
  position: number;
}

export interface CustomField {
  id: string;
  issueTypeId: string | null;
  name: string;
  fieldType: CustomFieldType;
  // When true the field renders in the issue body (under the description);
  // when false it renders as a Properties row.
  showInBody: boolean;
  position: number;
  options: CustomFieldOption[];
}

// One custom field value on a team issue: the scalar value (null for
// select/multi_select and unset fields) and the selected option ids. Only
// fields with a value set appear; unset fields are omitted (see listIssues).
export interface IssueFieldValueEntry {
  fieldId: string;
  value: string | number | boolean | null;
  optionIds: string[];
}

export interface Issue {
  id: string;
  teamId: string;
  // Team-scoped sequence number (the "42" in "MKT-42"). Addresses the issue by
  // its human number in URLs (/team/MKT/issue/42).
  sequenceNumber: number;
  identifier: string;
  typeId: string | null;
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
  startDate: string | null;
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
  // When the issue entered its current column (or createdAt if it never moved).
  // Drives the "time in current status" badge.
  statusSince: string;
  // Unguessable token for the public read-only share link, or null when not shared.
  shareToken: string | null;
  labelIds: string[];
  fieldValues: IssueFieldValueEntry[];
}

// A light search result from GET /teams/:key/issues/search: enough to list and
// open a match, without the full issue's description or field values.
export interface IssueSearchHit {
  id: string;
  sequenceNumber: number;
  identifier: string;
  title: string;
  stateId: string;
  typeId: string | null;
  projectId: string | null;
  assigneeUserId: string | null;
  delegateUserId: string | null;
  priority: number;
  dueDate: string | null;
  labelIds: string[];
  archived: boolean;
}

// Per-team auto-archive thresholds: days an issue may sit inactive in a
// completed/canceled column before the worker archives it. null disables archiving
// for that state group. Both null by default (nothing is archived until enabled).
export interface AutoArchiveSettings {
  completedDays: number | null;
  canceledDays: number | null;
}

// Which optional sections a team shows. All on by default; turning one off
// hides its navigation entry and its section, keeping the rows behind it.
export interface TeamFeatures {
  projects: boolean;
  dashboards: boolean;
  notes: boolean;
}

// A team's settings: MCP reachability, the enabled sections and the
// auto-archive thresholds.
export interface TeamSettings {
  mcpEnabled: boolean;
  features: TeamFeatures;
  autoArchive: AutoArchiveSettings;
}

// Per-team notification provider credentials (owner-managed) plus a member's own
// delivery preferences. The issue events match the inbox notification types.
export type NotificationEncryption = 'none' | 'ssl' | 'tls';

export interface NotificationEventToggles {
  assigned: boolean;
  mentioned: boolean;
  commented: boolean;
  state_changed: boolean;
}

// The provider credentials as read from the API: secrets are never returned, only a
// `hasX` flag telling whether a value is stored.
export interface NotificationSettings {
  // Deliver email through the instance provider instead of the team's own. Its
  // credentials belong to the instance, so the team only turns it on.
  system: { enabled: boolean };
  // Whether the instance provider exists and is shared with teams right now.
  systemAvailable: boolean;
  smtp: {
    enabled: boolean;
    host: string;
    port: number | null;
    encryption: NotificationEncryption;
    username: string;
    hasPassword: boolean;
    timeout: number | null;
  };
  resend: { enabled: boolean; hasApiKey: boolean };
  telegram: { enabled: boolean; hasBotToken: boolean };
}

// A partial write. Each section is optional so a provider card saves on its own.
// A secret field left out or empty keeps its stored value.
export interface NotificationSettingsPatch {
  system?: { enabled: boolean };
  smtp?: {
    enabled: boolean;
    host: string;
    port: number | null;
    encryption: NotificationEncryption;
    username: string;
    password?: string;
    timeout: number | null;
  };
  resend?: { enabled: boolean; apiKey?: string };
  telegram?: { enabled: boolean; botToken?: string };
}

// ── Storage limits ────────────────────────────────────────────────────────────

// The instance upload limits. Readable by any signed-in user, because the upload UI
// states them before a file is picked; only god mode can change them.
export interface StorageSettings {
  maxAttachmentMb: number;
  maxAvatarMb: number;
  // Accepted attachment content types: a full type ('application/pdf') or a
  // wildcard ('image/*'). Empty means any type is accepted.
  attachmentMimeTypes: string[];
  // Stored attachment bytes allowed per team, in MB. 0 means unlimited.
  teamQuotaMb: number;
}

export type StorageSettingsPatch = Partial<StorageSettings>;

// One release. The ones above the running version come from the repository's feed
// and carry HTML notes; the ones up to it come from this build's changelog and
// carry markdown.
export interface Release {
  tag: string;
  version: string;
  publishedAt: string;
  url: string | null;
  notes: string;
  notesFormat: 'html' | 'markdown';
}

// How the running version compares to what is published. `latestVersion` and
// `checkedAt` are null until an upstream check has succeeded.
export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  releases: Release[];
}

// ── Instance administration (god mode) ────────────────────────────────────────

// Who may create an account on this instance.
export type RegistrationMode = 'open' | 'invite' | 'closed';

// The instance sign-in policy. hasEmailProvider tells whether outbound mail works;
// the options that depend on it cannot be turned on without one.
export interface InstanceAuthSettings {
  registration: RegistrationMode;
  requireEmailVerification: boolean;
  magicLink: boolean;
  hasEmailProvider: boolean;
}

export interface InstanceAuthSettingsPatch {
  registration?: RegistrationMode;
  requireEmailVerification?: boolean;
  magicLink?: boolean;
}

// The instance mail provider used for authentication email (password reset, address
// verification, magic links). Separate from a team's notification provider.
// Secrets are never returned, only a `hasX` flag.
export interface InstanceEmailSettings {
  smtp: {
    enabled: boolean;
    host: string;
    port: number | null;
    encryption: NotificationEncryption;
    username: string;
    hasPassword: boolean;
    timeout: number | null;
  };
  resend: { enabled: boolean; hasApiKey: boolean };
  from: string;
  // Whether teams may deliver their notifications through this provider.
  allowTeams: boolean;
}

export interface InstanceEmailSettingsPatch {
  smtp?: {
    enabled: boolean;
    host: string;
    port: number | null;
    encryption: NotificationEncryption;
    username: string;
    password?: string;
    timeout: number | null;
  };
  resend?: { enabled: boolean; apiKey?: string };
  from?: string;
  allowTeams?: boolean;
}

// The Google OAuth credentials used for social sign-in. The client secret is never
// returned, only a `hasClientSecret` flag. redirectUri is derived from the API origin
// and has to be registered in the Google Cloud console.
export interface InstanceGoogleSettings {
  enabled: boolean;
  clientId: string;
  hasClientSecret: boolean;
  redirectUri: string;
}

export interface InstanceGoogleSettingsPatch {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
}

// The instance Telegram bot: the one bot users link their accounts through, and the
// default sender for Telegram notifications. `botUsername` is resolved from Telegram
// when the token is saved.
export interface InstanceTelegramSettings {
  enabled: boolean;
  botUsername: string;
  hasBotToken: boolean;
}
export interface InstanceTelegramSettingsPatch {
  enabled?: boolean;
  botToken?: string;
}

// One account in the instance user directory. `role` is the global better-auth role
// ("god" for the instance owner), which is unrelated to team membership.
export interface InstanceUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  role: string;
  isAgent: boolean;
  providers: string[];
  teamCount: number;
  lastSeenAt: string | null;
  createdAt: string;
}

// A team the user can reach, with the permissions their membership resolves to
// (full for an owner, the assigned role's matrix for a member).
export interface InstanceUserTeam {
  teamId: string;
  teamKey: string;
  teamName: string;
  role: MemberRole;
  roleId: string | null;
  roleName: string | null;
  permissions: Permissions;
  // How many owners the team has. 1 on a team this user owns means deleting
  // the account would leave the team with nobody who can manage it.
  ownerCount: number;
  joinedAt: string;
}

export interface InstanceUserDetail extends InstanceUser {
  teams: InstanceUserTeam[];
}

// Which accounts the directory lists: real people, the bot users behind AI agents,
// or both.
export type InstanceUserKind = 'human' | 'agent' | 'all';

// One page of the directory. `total` counts every account matching the filters, so
// the pager can show the range and know whether there is a next page.
export interface InstanceUserPage {
  items: InstanceUser[];
  total: number;
}

// One team in the instance team directory, with what it holds counted across
// its dependent tables. `lastActivityAt` is the most recent entry in its issue feed.
export interface InstanceTeam {
  id: string;
  key: string;
  name: string;
  description: string;
  mcpEnabled: boolean;
  memberCount: number;
  issueCount: number;
  archivedIssueCount: number;
  projectCount: number;
  dashboardCount: number;
  viewCount: number;
  agentCount: number;
  skillCount: number;
  toolCount: number;
  integrationCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

// One member of a team, with the permissions their membership resolves to (full
// for an owner, the assigned role's matrix for a member).
export interface InstanceTeamMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  isAgent: boolean;
  role: MemberRole;
  roleId: string | null;
  roleName: string | null;
  permissions: Permissions;
  joinedAt: string;
}

export interface InstanceTeamDetail extends InstanceTeam {
  members: InstanceTeamMember[];
}

export interface InstanceTeamPage {
  items: InstanceTeam[];
  total: number;
}

// What the sign-in and sign-up screens read before there is a session. magicLink,
// requireEmailVerification and google are already resolved against their provider by
// the API, so a screen can trust them without checking the credentials itself.
export interface PublicAuthConfig {
  registration: RegistrationMode;
  magicLink: boolean;
  requireEmailVerification: boolean;
  emailEnabled: boolean;
  google: boolean;
}

// The session member's own notification preferences for a team: which issue
// events they want by email and/or Telegram. Email is sent to the member's account
// address, Telegram to the account they linked in their profile.
export interface NotificationPreferences {
  emailEvents: NotificationEventToggles;
  telegramEvents: NotificationEventToggles;
}

// The session user's Telegram link. `botUsername` is null when no instance bot is
// configured, which is when Telegram is not offered at all; `link` is null while the
// user has not connected an account.
export interface TelegramAccount {
  botUsername: string | null;
  link: { username: string | null; firstName: string | null; linkedAt: string } | null;
}

// The deep link that completes a Telegram connection, and when its code expires.
export interface TelegramLinkStart {
  url: string;
  expiresAt: string;
}

// The signed-in user's interface preferences, held per account so they apply on
// every device. timezone is an IANA zone name the app renders stored UTC timestamps
// in; issueOpenMode decides whether a clicked issue opens in the side panel or on
// its own page; startPage is the section the app root lands on; showChatByDefault
// keeps the floating AI chat button on screen from the start; lastTeamId is the
// team the app root reopens (null until the user has opened one).
export type ThemePreference = 'light' | 'dark' | 'system';
export type IssueOpenMode = 'panel' | 'page';
export type StartPage = 'inbox' | 'dashboard' | 'work-items' | 'projects' | 'ai-chat';
export type IssueStatsView = 'compact' | 'timeline';

export interface AccountPreferences {
  timezone: string;
  theme: ThemePreference;
  issueOpenMode: IssueOpenMode;
  startPage: StartPage;
  showChatByDefault: boolean;
  // How the status stats section of an issue starts out: expanded or collapsed, and
  // in the compact bar or the full timeline. Switching it on an issue is not saved —
  // it lasts as long as that issue stays open.
  issueStatsOpen: boolean;
  issueStatsView: IssueStatsView;
  lastTeamId: string | null;
  // The keyboard shortcuts this user rebound, as { commandId: combo }. Only the
  // changed ones; the rest come from the instance settings, then the built-in
  // bindings (see lib/hotkeys).
  hotkeys: HotkeyOverrides;
}

// Rebound keyboard shortcuts: the combination each overridden command id takes. A
// command left out keeps the binding from the layer below.
export type HotkeyOverrides = Record<string, string>;

export type AccountPreferencesPatch = Partial<AccountPreferences>;

// A saved view (a tab above the work items view): a named filter set plus a display
// snapshot (layout + that layout's settings). Shared across clients — there is
// no per-user identity. filters/display are stored as jsonb.
export interface View {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  filters: FilterSet;
  display: SavedViewDisplay;
  position: number;
  // Unguessable token for the public read-only share link, or null when not shared.
  shareToken: string | null;
  createdAt: string;
}

export interface NewViewInput {
  name: string;
  icon?: string | null;
  filters?: FilterSet;
  display?: SavedViewDisplay;
}

export interface ViewPatch {
  name?: string;
  icon?: string | null;
  filters?: FilterSet;
  display?: SavedViewDisplay;
}

// A saved dashboard: the analytics counterpart of a View. `layout` is the ordered
// list of widgets (owned by the UI, stored verbatim server-side as jsonb).
export interface Dashboard {
  id: string;
  teamId: string;
  name: string;
  icon: string | null;
  layout: DashboardLayout;
  position: number;
  createdAt: string;
}

export interface NewDashboardInput {
  name: string;
  icon?: string | null;
  layout?: DashboardLayout;
}

export interface DashboardPatch {
  name?: string;
  icon?: string | null;
  layout?: DashboardLayout;
}

// --- Note board DTOs -------------------------------------------------------------

// One sticky note on the canvas. body is markdown (may contain task-list items).
// color keys a background swatch defined by the UI. Declared as a type alias (not
// an interface) so it carries an implicit index signature and satisfies React
// Flow's Node data constraint (Record<string, unknown>).
export type NoteSticker = {
  title: string;
  body: string;
  color: string;
};

// A React Flow node holding a sticker. Kept structurally compatible with React
// Flow's Node so the canvas can use it directly.
export interface NoteNode {
  id: string;
  type: 'sticker';
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: NoteSticker;
}

// A connection between two stickers (React Flow edge).
export interface NoteEdge {
  id: string;
  source: string;
  target: string;
}

// The board canvas, stored verbatim as jsonb on the server.
export interface NoteCanvas {
  nodes: NoteNode[];
  edges: NoteEdge[];
}

export interface NoteBoard {
  id: string;
  teamId: string;
  // null for a public board (every member sees it); a user id for a personal
  // board only its owner sees.
  ownerUserId: string | null;
  name: string;
  canvas: NoteCanvas;
  createdAt: string;
  updatedAt: string;
}

// A board without its canvas — what the switcher and MRU tabs list. The canvas is
// loaded one board at a time via getNoteBoard when the board is opened.
export type NoteBoardSummary = Omit<NoteBoard, 'canvas'>;

export interface NewNoteBoardInput {
  name: string;
  personal?: boolean;
  canvas?: NoteCanvas;
}

export interface NoteBoardPatch {
  name?: string;
  canvas?: NoteCanvas;
  // Sets the board's visibility: true makes it personal to the caller, false public.
  personal?: boolean;
}

export interface NoteBoardListParams {
  q?: string;
  limit?: number;
  offset?: number;
}

// --- Analytics DTOs (team metrics behind the dashboard widgets) ---------------

export interface AnalyticsStats {
  open: number;
  inProgress: number;
  backlog: number;
  overdue: number;
  unassigned: number;
  closedLast7d: number;
}

export interface BreakdownItem {
  key: string;
  label: string;
  count: number;
  color: string | null;
}

export type PulseUnit = 'hour' | 'day' | 'week';

// One heatmap cell from the server: a preformatted bucket label (for the hover
// tooltip) and its activity count. The series is ordered oldest to newest.
export interface PulseBucket {
  label: string;
  count: number;
}

export interface ThroughputWeek {
  week: string;
  created: number;
  closed: number;
}

// One agent run in the team-wide feed (agent runs widget).
export interface AgentRunFeedItem {
  id: string;
  status: 'pending' | 'success' | 'failed';
  trigger: 'mention' | 'delegation' | 'schedule' | 'manual';
  agentId: string;
  agentName: string;
  issueId: string | null;
  issueSequence: number | null;
  lastError: string | null;
  createdAt: string;
}

// Agent run outcome counts over a window (agent health widget).
export interface AgentRunStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
}

// Webhook delivery health over a window plus the subscription split (webhook health widget).
export interface WebhookStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  activeWebhooks: number;
  disabledWebhooks: number;
}

// One agent's workload row: delegated open issues and lifetime run outcomes.
export interface AgentWorkloadItem {
  agentId: string;
  agentName: string;
  kind: string;
  delegatedOpen: number;
  runsTotal: number;
  runsSuccess: number;
  runsFailed: number;
}

export interface ActivityItem {
  id: string;
  issueId: string;
  issueSequence: number;
  issueTitle: string;
  kind: 'comment' | 'activity';
  actorUserId: string | null;
  actorName: string | null;
  body: string | null;
  action: ActivityAction | null;
  subject: string | null;
  fromText: string | null;
  toText: string | null;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: FeedCursor | null;
}

// A manual action: a saved macro on a team. `condition` is a FilterSet (empty
// = always available) that decides which issues the action shows on; `effect`
// is a partial issue patch over built-in fields applied in one update when the
// action runs. A present effect key sets that field (value may be null); an
// absent key leaves it unchanged.
export type ActionEffect = Pick<
  IssuePatch,
  'stateId' | 'assigneeUserId' | 'priority' | 'typeId' | 'startDate' | 'dueDate' | 'labelIds'
>;

export interface ActionDef {
  id: string;
  teamId: string;
  name: string;
  icon: string;
  condition: FilterSet;
  effect: ActionEffect;
  position: number;
  createdAt: string;
}

export interface NewActionInput {
  name: string;
  icon?: string;
  condition?: FilterSet;
  effect?: ActionEffect;
}

export interface ActionPatch {
  name?: string;
  icon?: string;
  condition?: FilterSet;
  effect?: ActionEffect;
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
  | 'InitiativeUpdate';

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

// A recorded delivery attempt for the history view. payload is the request body we
// sent; responseStatus/responseBody come from the last attempt; lastError is set
// on a failed or retrying delivery.
export interface WebhookDelivery {
  id: string;
  eventId: string;
  // The Linear resource type of the event (Issue, Comment, …).
  eventType: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  payload: unknown;
  responseStatus: number | null;
  responseBody: string | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

export interface WebhookDeliveryPage {
  items: WebhookDelivery[];
  nextCursor: string | null;
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
// display-ready value snapshots (column/label/type/assignee name, raw priority,
// ISO date, or the new text of a long field). `subject` names the changed
// sub-item where the action alone is not enough (the custom field name for 'field').
export type ActivityAction =
  | 'created'
  | 'title'
  | 'description'
  | 'status'
  | 'assignee'
  | 'delegate'
  | 'priority'
  | 'type'
  | 'start_date'
  | 'due_date'
  | 'label_add'
  | 'label_remove'
  | 'field'
  | 'archived'
  | 'restored'
  | 'relation';

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
}

// Opaque keyset cursor returned by the feed endpoint; pass it back to load the
// next (older) page.
export interface FeedCursor {
  ts: string;
  id: string;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: FeedCursor | null;
}

// One stretch the issue spent in a single column. `status` is the column-name
// snapshot taken at the time (null only when the issue has no status history and its
// column was deleted); `to` is null for the stretch the issue is in now. The entries
// written inside a stretch are a separate read (listTimelineItems), made when one is
// opened.
export interface TimelineSegment {
  status: string | null;
  from: string;
  to: string | null;
  durationMs: number;
}

export interface IssueFieldValue {
  fieldId: string;
  name: string;
  fieldType: CustomFieldType;
  value: string | number | boolean | null;
  optionIds: string[];
}

// A custom field value on the way in (setFieldValue). `value` carries the
// scalar types, `optionIds` the select/multi_select ones; a field uses one or
// the other.
export interface IssueFieldValueInput {
  value?: string | number | boolean | null;
  optionIds?: string[];
}

// The caller's own role in a team (owner/member). Returned with the team;
// the resolved permission matrix is a sibling `permissions` field. See
// usePermissions.
export interface TeamViewer {
  role: MemberRole;
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
  issueTypes: IssueType[];
  labels: Label[];
  labelGroups: LabelGroup[];
  assignees: Assignee[];
  // Every custom field of the team (all type scopes); consumers filter by
  // issueTypeId locally.
  customFields: CustomField[];
  viewer: TeamViewer;
  // The caller's resolved permission matrix (owners get every flag).
  permissions: Permissions;
}

// The board's issues plus its change marker, returned by getBoardIssues. Polled
// for live refresh (rev matches getBoardIssuesRev).
export interface BoardIssues {
  issues: Issue[];
  rev: string;
}

// The scaffold composed with its issues, as the Shell assembles it and passes it
// down. Downstream reads team.issues / team.rev off this composite.
export type TeamDetail = TeamScaffold & BoardIssues;

export interface IssueDetail extends Issue {
  fields: IssueFieldValue[];
}

// Public read-only share bundles, returned by the /share/* routes with no session.
// The scaffold mirrors TeamScaffold minus the caller's viewer/permissions and
// member emails (a public page shows names and avatars only).
export type PublicScaffold = Omit<TeamScaffold, 'viewer' | 'permissions' | 'assignees'> & {
  assignees: Omit<Assignee, 'email'>[];
};

export interface SharedIssueBundle {
  team: PublicScaffold;
  issue: IssueDetail;
  feed: FeedItem[];
}

export interface SharedViewBundle {
  team: PublicScaffold;
  view: { name: string; icon: string | null; filters: FilterSet; display: SavedViewDisplay };
  issues: Issue[];
}

export interface NewIssueInput {
  typeId?: string | null;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  stateId: string;
  title: string;
  description?: string;
  priority?: number;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

// The fields a bulk update can set on many issues at once (the board-relevant
// subset of IssuePatch: no title/description/position).
export interface BulkIssuePatch {
  stateId?: string;
  typeId?: string | null;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  priority?: number;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface IssuePatch {
  stateId?: string;
  position?: number;
  typeId?: string | null;
  projectId?: string | null;
  assigneeUserId?: string | null;
  delegateUserId?: string | null;
  title?: string;
  description?: string;
  priority?: number;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

// --- Projects -----------------------------------------------------------------
// A project (Linear's Project) across one or more teams. progress and
// computedHealth are derived server-side from the linked issues' states.

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
  // Derived from issue progress against the timeline; shown when there is no update.
  computedHealth: ProjectHealth | null;
}

// Columns the project list can be sorted by, server-side. progress and health
// are derived and not sortable.
export const PROJECT_SORTS = ['name', 'priority', 'targetDate', 'lead'] as const;

export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface ProjectListParams {
  statuses?: string[];
  search?: string;
  sort?: ProjectSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ProjectPage {
  items: Project[];
  total: number;
  page: number;
  pageSize: number;
}

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

export interface NewCustomFieldInput {
  issueTypeId?: string | null;
  name: string;
  fieldType: CustomFieldType;
  showInBody?: boolean;
  options?: string[];
}

// The team permission matrix (mirrors apps/api shared/permissions.ts): 13
// resources, each granting or denying 4 actions. A custom role carries one matrix.
export type PermissionAction = 'create' | 'edit' | 'read' | 'delete';

export type PermissionResource =
  | 'work_items'
  | 'projects'
  | 'dashboards'
  | 'views'
  | 'members_invite'
  | 'members_manage'
  | 'states'
  | 'issue_types'
  | 'labels'
  | 'ai_agents'
  | 'integrations'
  | 'agent_skills'
  | 'agent_tools'
  | 'custom_fields'
  | 'actions'
  | 'webhooks'
  | 'danger_zone';

export type ResourcePermissions = Record<PermissionAction, boolean>;
export type Permissions = Record<PermissionResource, ResourcePermissions>;

// A team's custom role: a named permission matrix that can be assigned to a
// member. `isDefault` marks the fallback role new members get; it cannot be deleted.
export interface Role {
  id: string;
  name: string;
  isDefault: boolean;
  permissions: Permissions;
  createdAt: string;
}

// The resources and actions the role editor renders. Fetched so the UI matches the
// API's matrix without hardcoding the list in two places.
export interface PermissionCatalog {
  resources: PermissionResource[];
  actions: PermissionAction[];
}

// Team membership: a user's access to a team and their role in it. New
// members join through invites, not a direct add.
export type MemberRole = 'owner' | 'member';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: MemberRole;
  // The assigned custom role. null when the member uses the team's default
  // role; owners never use roles (both fields null).
  roleId: string | null;
  roleName: string | null;
  // What this member does in the team, set by an owner. Empty string when unset.
  description: string;
  // True when this member is an AI agent's bot user. Its role and access are managed
  // on the AI Agents screen, so this list does not let you reassign or revoke it.
  isAgent: boolean;
  createdAt: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'rejected';

// An invite as shown to the owner managing a team's invites: carries the token
// so the owner can share the link, and who sent it.
export interface InviteRow {
  id: string;
  token: string;
  email: string;
  role: MemberRole;
  // The custom role the invitee joins on (for a member invite). null falls back
  // to the default role; roleName resolves it for display. An owner invite has
  // both null.
  roleId: string | null;
  roleName: string | null;
  status: InviteStatus;
  createdAt: string;
  respondedAt: string | null;
  invitedByName: string | null;
  invitedByEmail: string | null;
}

// An invite as shown to the invitee opening the link: enough team context to
// decide, never the internal team id.
export interface InviteView {
  token: string;
  teamKey: string;
  teamName: string;
  email: string;
  role: MemberRole;
  roleId: string | null;
  roleName: string | null;
  status: InviteStatus;
  createdAt: string;
  // Whether the invited email already has an account, so the accept screen can
  // open in sign-in mode instead of registration.
  hasAccount: boolean;
}

// The attachment DTO's url is relative to the API origin; make it absolute so it
// works in <img>/<video> and markdown rendered on the web origin.
function absolutizeAttachment(a: Attachment): Attachment {
  return { ...a, url: a.url.startsWith('http') ? a.url : `${API_URL}${a.url}` };
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
  createdAt: string;
  issueId: string;
  issueSeq: number;
  issueTitle: string;
  issueStateType: StateType;
  teamId: string;
  teamKey: string;
  teamName: string;
}

export interface NotificationCursor {
  ts: string;
  id: string;
}

export interface NotificationPage {
  items: Notification[];
  nextCursor: NotificationCursor | null;
}

export interface NotificationFilters {
  types?: NotificationType[];
  from?: string;
  includeRead?: boolean;
  includeSnoozed?: boolean;
}

export type NotificationDeleteScope = 'all' | 'read' | 'read-completed';

export const api = {
  listTeams: (opts?: { permissions?: boolean }) =>
    request<Team[]>(`/teams${opts?.permissions ? '?permissions=true' : ''}`),
  createTeam: (input: { key: string; name: string; description?: string; preset?: string }) =>
    request<Team>('/teams', { method: 'POST', body: JSON.stringify(input) }),
  copyTeam: (
    teamKey: string,
    input: {
      key: string;
      name: string;
      description?: string;
      include?: Partial<Record<CopyTeamIncludeKey, boolean>>;
    },
  ) =>
    request<Team>(`/teams/${teamKey}/copy`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  // Update a team's name/description. The key is immutable, so it is not sent.
  updateTeam: (teamKey: string, patch: { name?: string; description?: string }) =>
    request<Team>(`/teams/${teamKey}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTeam: (teamKey: string) => request<void>(`/teams/${teamKey}`, { method: 'DELETE' }),
  // The board scaffold (no issues). The issues come from getBoardIssues.
  getTeam: (teamKey: string) => request<TeamScaffold>(`/teams/${teamKey}`),
  // The board's issues plus its change marker.
  getBoardIssues: (teamKey: string) => request<BoardIssues>(`/teams/${teamKey}/issues/board`),
  // Cheap change marker for the board issues — polled for live refresh, refetch
  // getBoardIssues only when rev changes.
  getBoardIssuesRev: (teamKey: string) => request<{ rev: string }>(`/teams/${teamKey}/issues/rev`),

  createState: (teamKey: string, input: { name: string; stateType: StateType; color?: string }) =>
    request<Column>(`/teams/${teamKey}/columns`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateState: (
    teamKey: string,
    stateId: string,
    patch: { name?: string; stateType?: StateType; color?: string },
  ) =>
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

  createIssueType: (
    teamKey: string,
    input: { name: string; icon?: string; color?: string; isDefault?: boolean },
  ) =>
    request<IssueType>(`/teams/${teamKey}/issue-types`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateIssueType: (
    teamKey: string,
    typeId: string,
    patch: { name?: string; color?: string; isDefault?: boolean },
  ) =>
    request<IssueType>(`/teams/${teamKey}/issue-types/${typeId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteIssueType: (teamKey: string, typeId: string) =>
    request<void>(`/teams/${teamKey}/issue-types/${typeId}`, { method: 'DELETE' }),

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

  listCustomFields: (teamKey: string, issueTypeId?: string) =>
    request<CustomField[]>(
      `/teams/${teamKey}/custom-fields${issueTypeId != null ? `?issueTypeId=${issueTypeId}` : ''}`,
    ),
  createCustomField: (teamKey: string, input: NewCustomFieldInput) =>
    request<CustomField>(`/teams/${teamKey}/custom-fields`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCustomField: (
    teamKey: string,
    fieldId: string,
    patch: { name?: string; showInBody?: boolean },
  ) =>
    request<CustomField>(`/teams/${teamKey}/custom-fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCustomField: (teamKey: string, fieldId: string) =>
    request<void>(`/teams/${teamKey}/custom-fields/${fieldId}`, { method: 'DELETE' }),

  createIssue: (teamKey: string, input: NewIssueInput) =>
    request<Issue>(`/teams/${teamKey}/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getIssue: (id: string) => request<IssueDetail>(`/issues/${id}`),

  // Public read-only sharing. Enable returns the link token (idempotent); disable
  // revokes it. The getShared* reads need no session (public /share/* routes).
  enableIssueShare: (id: string) =>
    request<{ token: string }>(`/issues/${id}/share`, { method: 'POST' }),
  disableIssueShare: (id: string) => request<void>(`/issues/${id}/share`, { method: 'DELETE' }),
  enableViewShare: (id: string) =>
    request<{ token: string }>(`/views/${id}/share`, { method: 'POST' }),
  disableViewShare: (id: string) => request<void>(`/views/${id}/share`, { method: 'DELETE' }),
  getSharedIssue: (token: string) => request<SharedIssueBundle>(`/share/issue/${token}`),
  getSharedView: (token: string) => request<SharedViewBundle>(`/share/view/${token}`),
  getSharedViewIssue: (token: string, issueId: string) =>
    request<SharedIssueBundle>(`/share/view/${token}/issues/${issueId}`),
  // Resolve an issue by its team-scoped number (the human "42" in the URL).
  getIssueBySeq: (teamKey: string, seq: number) =>
    request<IssueDetail>(`/teams/${teamKey}/issues/${seq}`),
  // Cheap change marker for an issue's detail + feed — polled for live refresh.
  getIssueRev: (id: string) => request<{ rev: string }>(`/issues/${id}/rev`),
  updateIssue: (id: string, patch: IssuePatch) =>
    request<Issue>(`/issues/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteIssue: (id: string) => request<void>(`/issues/${id}`, { method: 'DELETE' }),
  // Board multi-select: apply one change to many issues in a single request. The
  // server filters the ids to the team and refetching happens once.
  bulkUpdateIssues: (teamKey: string, ids: string[], patch: BulkIssuePatch) =>
    request<{ updated: number }>(`/teams/${teamKey}/issues/bulk`, {
      method: 'PATCH',
      body: JSON.stringify({ ids, patch }),
    }),
  bulkAddLabels: (teamKey: string, ids: string[], add: string[]) =>
    request<{ updated: number }>(`/teams/${teamKey}/issues/bulk/labels`, {
      method: 'POST',
      body: JSON.stringify({ ids, add }),
    }),
  bulkArchiveIssues: (teamKey: string, ids: string[]) =>
    request<{ archived: number }>(`/teams/${teamKey}/issues/bulk/archive`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  bulkDeleteIssues: (teamKey: string, ids: string[]) =>
    request<{ deleted: number }>(`/teams/${teamKey}/issues/bulk/delete`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  // Archive/restore: hide an issue from the board (kept, restorable) or bring it
  // back. The board excludes archived issues; the archive settings section lists them.
  archiveIssue: (id: string) => request<Issue>(`/issues/${id}/archive`, { method: 'POST' }),
  restoreIssue: (id: string) => request<Issue>(`/issues/${id}/restore`, { method: 'POST' }),
  listArchivedIssues: (teamKey: string) => request<Issue[]>(`/teams/${teamKey}/issues/archived`),
  // Server-side text search for the command palette. Always returns all matches,
  // archived included (each hit carries an `archived` flag).
  searchIssues: (teamKey: string, params: { q?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit != null) qs.set('limit', String(params.limit));
    return request<IssueSearchHit[]>(`/teams/${teamKey}/issues/search?${qs.toString()}`);
  },
  setFieldValue: (issueId: string, fieldId: string, input: IssueFieldValueInput) =>
    request<{ ok: boolean }>(`/issues/${issueId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  listAttachments: (issueId: string) =>
    request<Attachment[]>(`/issues/${issueId}/attachments`).then((rows) =>
      rows.map(absolutizeAttachment),
    ),
  // Multipart upload — cannot use request(), which forces a JSON Content-Type;
  // the browser must set the multipart boundary itself, so no headers are set.
  uploadAttachment: async (issueId: string, file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/issues/${issueId}/attachments`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
    }
    return absolutizeAttachment(await res.json());
  },
  deleteAttachment: (publicId: string) =>
    request<void>(`/attachments/${publicId}`, { method: 'DELETE' }),

  listFeed: (issueId: string, params: { cursor?: FeedCursor | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', JSON.stringify(params.cursor));
    const qs = q.toString();
    return request<FeedPage>(`/issues/${issueId}/feed${qs ? `?${qs}` : ''}`);
  },
  listTimeline: (issueId: string) => request<TimelineSegment[]>(`/issues/${issueId}/timeline`),
  // The entries of one stretch of the timeline: [from, to), open-ended without `to`.
  listTimelineItems: (issueId: string, from: string, to: string | null) => {
    const q = new URLSearchParams({ from });
    if (to) q.set('to', to);
    return request<FeedItem[]>(`/issues/${issueId}/timeline/items?${q.toString()}`);
  },
  createComment: (issueId: string, input: { body: string }) =>
    request<FeedItem>(`/issues/${issueId}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Projects span teams: the list and counts take an optional team filter, create
  // takes the team ids, and ops on one project take its id.
  listProjects: (teamKey: string | null, params: ProjectListParams = {}) => {
    const q = new URLSearchParams();
    if (teamKey) q.set('teamKey', teamKey);
    if (params.statuses && params.statuses.length) q.set('status', params.statuses.join(','));
    if (params.search) q.set('search', params.search);
    if (params.sort) q.set('sort', params.sort);
    if (params.dir) q.set('dir', params.dir);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    const qs = q.toString();
    return request<ProjectPage>(`/projects?${qs}`);
  },
  projectCounts: (teamKey: string | null) =>
    request<ProjectCounts>(
      `/projects/counts${teamKey ? `?teamKey=${encodeURIComponent(teamKey)}` : ''}`,
    ),
  setProjectTeams: (id: string, teamIds: string[]) =>
    request<Project>(`/projects/${id}/teams`, {
      method: 'PUT',
      body: JSON.stringify({ teamIds }),
    }),
  listProjectMilestones: (id: string) => request<ProjectMilestone[]>(`/projects/${id}/milestones`),
  listProjectLabels: () => request<ProjectLabel[]>('/project-labels'),
  createProjectLabel: (input: { name: string; color?: string }) =>
    request<ProjectLabel>('/project-labels', { method: 'POST', body: JSON.stringify(input) }),
  updateProjectLabel: (id: string, patch: { name?: string; color?: string }) =>
    request<ProjectLabel>(`/project-labels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProjectLabel: (id: string) => request<void>(`/project-labels/${id}`, { method: 'DELETE' }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (input: NewProjectInput & { teamIds: string[] }) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProject: (id: string, patch: ProjectPatch) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  // Cheap change marker for an project's detail + feed — polled for live refresh.
  getProjectRev: (id: string) => request<{ rev: string }>(`/projects/${id}/rev`),
  listProjectFeed: (id: string, params: { cursor?: FeedCursor | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', JSON.stringify(params.cursor));
    const qs = q.toString();
    return request<ProjectFeedPage>(`/projects/${id}/feed${qs ? `?${qs}` : ''}`);
  },

  listViews: (teamKey: string) => request<View[]>(`/teams/${teamKey}/views`),
  createView: (teamKey: string, input: NewViewInput) =>
    request<View>(`/teams/${teamKey}/views`, { method: 'POST', body: JSON.stringify(input) }),
  updateView: (viewId: string, patch: ViewPatch) =>
    request<View>(`/views/${viewId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteView: (viewId: string) => request<void>(`/views/${viewId}`, { method: 'DELETE' }),
  reorderViews: (teamKey: string, orderedIds: string[]) =>
    request<View[]>(`/teams/${teamKey}/views/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),

  // Dashboards — same CRUD shape as views: collection ops take teamKey, ops on
  // a single dashboard take its own id and hit /dashboards/:id.
  listDashboards: (teamKey: string) => request<Dashboard[]>(`/teams/${teamKey}/dashboards`),
  createDashboard: (teamKey: string, input: NewDashboardInput) =>
    request<Dashboard>(`/teams/${teamKey}/dashboards`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDashboard: (dashboardId: string, patch: DashboardPatch) =>
    request<Dashboard>(`/dashboards/${dashboardId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteDashboard: (dashboardId: string) =>
    request<void>(`/dashboards/${dashboardId}`, { method: 'DELETE' }),
  reorderDashboards: (teamKey: string, orderedIds: string[]) =>
    request<Dashboard[]>(`/teams/${teamKey}/dashboards/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),

  // Note boards — all ops are team-scoped (a personal board is filtered to its
  // owner server-side), so board ops take teamKey plus the board id. The list
  // is paged and searchable (switcher); a single board carries its canvas.
  listNoteBoards: (teamKey: string, params: NoteBoardListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<NoteBoardSummary[]>(`/teams/${teamKey}/note-boards${suffix}`);
  },
  getNoteBoard: (teamKey: string, boardId: string) =>
    request<NoteBoard>(`/teams/${teamKey}/note-boards/${boardId}`),
  createNoteBoard: (teamKey: string, input: NewNoteBoardInput) =>
    request<NoteBoard>(`/teams/${teamKey}/note-boards`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateNoteBoard: (teamKey: string, boardId: string, patch: NoteBoardPatch) =>
    request<NoteBoard>(`/teams/${teamKey}/note-boards/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteNoteBoard: (teamKey: string, boardId: string) =>
    request<void>(`/teams/${teamKey}/note-boards/${boardId}`, { method: 'DELETE' }),

  // Analytics — read-only team metrics behind the dashboard widgets.
  getStats: (teamKey: string) => request<AnalyticsStats>(`/teams/${teamKey}/analytics/stats`),
  getBreakdown: (teamKey: string, by: BreakdownBy) =>
    request<BreakdownItem[]>(`/teams/${teamKey}/analytics/breakdown?by=${by}`),
  getPulse: (teamKey: string, unit: PulseUnit, columns: number) =>
    request<PulseBucket[]>(`/teams/${teamKey}/analytics/pulse?unit=${unit}&columns=${columns}`),
  getThroughput: (teamKey: string, weeks = 12) =>
    request<ThroughputWeek[]>(`/teams/${teamKey}/analytics/throughput?weeks=${weeks}`),
  listActivity: (
    teamKey: string,
    params: {
      cursor?: FeedCursor | null;
      limit?: number;
      actorUserId?: string | null;
      action?: string | null;
      issueIds?: string[] | null;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', JSON.stringify(params.cursor));
    if (params.actorUserId != null) q.set('actorUserId', params.actorUserId);
    if (params.action) q.set('action', params.action);
    if (params.issueIds) q.set('issueIds', params.issueIds.join(','));
    const qs = q.toString();
    return request<ActivityPage>(`/teams/${teamKey}/analytics/activity${qs ? `?${qs}` : ''}`);
  },
  getAgentRuns: (teamKey: string, params: { status?: string | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<AgentRunFeedItem[]>(
      `/teams/${teamKey}/analytics/agent-runs${qs ? `?${qs}` : ''}`,
    );
  },
  getAgentRunStats: (teamKey: string, days = 30) =>
    request<AgentRunStats>(`/teams/${teamKey}/analytics/agent-run-stats?days=${days}`),
  getWebhookStats: (teamKey: string, days = 30) =>
    request<WebhookStats>(`/teams/${teamKey}/analytics/webhook-stats?days=${days}`),
  getAgentWorkload: (teamKey: string) =>
    request<AgentWorkloadItem[]>(`/teams/${teamKey}/analytics/agent-workload`),

  // Members: list who is on a team, and revoke access (an owner removes
  // anyone; a member removes only themselves — leaving the team).
  listMembers: (teamKey: string) => request<MemberRow[]>(`/teams/${teamKey}/members`),
  removeMember: (teamKey: string, userId: string) =>
    request<void>(`/teams/${teamKey}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  // Set a member's role (owner-only). role 'owner' promotes to owner; role
  // 'member' assigns a custom role via roleId (null resets to the default role).
  // The last owner cannot be demoted — the API rejects it.
  setMemberRole: (
    teamKey: string,
    userId: string,
    input: { role: MemberRole; roleId?: string | null },
  ) =>
    request<void>(`/teams/${teamKey}/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  // Set what a member does in the team (owner-only). Empty string clears it.
  setMemberDescription: (teamKey: string, userId: string, description: string) =>
    request<void>(`/teams/${teamKey}/members/${encodeURIComponent(userId)}/description`, {
      method: 'PATCH',
      body: JSON.stringify({ description }),
    }),

  // AI agents: a team's bot users and their configuration. The plaintext key
  // is returned only by create and regenerate-key, so those responses carry it
  // alongside the agent; it is never part of a list/read.
  listAiAgents: (teamKey: string) => request<AiAgent[]>(`/teams/${teamKey}/ai-agents`),
  listAgentTools: (teamKey: string) => request<AgentTool[]>(`/teams/${teamKey}/ai-agents/tools`),
  createAiAgent: (teamKey: string, input: NewAiAgentInput) =>
    request<{ agent: AiAgent; apiKey: string | null }>(`/teams/${teamKey}/ai-agents`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAiAgent: (teamKey: string, agentId: string, patch: AiAgentPatch) =>
    request<AiAgent>(`/teams/${teamKey}/ai-agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  regenerateAiAgentKey: (teamKey: string, agentId: string) =>
    request<{ apiKey: string }>(`/teams/${teamKey}/ai-agents/${agentId}/regenerate-key`, {
      method: 'POST',
    }),
  deleteAiAgent: (teamKey: string, agentId: string) =>
    request<void>(`/teams/${teamKey}/ai-agents/${agentId}`, { method: 'DELETE' }),
  listAgentRuns: (teamKey: string, agentId: string, before?: string) =>
    request<AgentRunPage>(
      `/teams/${teamKey}/ai-agents/${agentId}/runs?limit=25${before ? `&before=${before}` : ''}`,
    ),
  listAgentSchedules: (teamKey: string) =>
    request<AgentSchedule[]>(`/teams/${teamKey}/agent-schedules`),
  createAgentSchedule: (teamKey: string, input: AgentScheduleInput) =>
    request<AgentSchedule>(`/teams/${teamKey}/agent-schedules`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAgentSchedule: (teamKey: string, scheduleId: string, patch: Partial<AgentScheduleInput>) =>
    request<AgentSchedule>(`/teams/${teamKey}/agent-schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteAgentSchedule: (teamKey: string, scheduleId: string) =>
    request<void>(`/teams/${teamKey}/agent-schedules/${scheduleId}`, { method: 'DELETE' }),
  runAgentSchedule: (teamKey: string, scheduleId: string) =>
    request<{ runId: string }>(`/teams/${teamKey}/agent-schedules/${scheduleId}/run`, {
      method: 'POST',
    }),
  listAgentScheduleRuns: (teamKey: string, scheduleId: string) =>
    request<AgentScheduleRun[]>(`/teams/${teamKey}/agent-schedules/${scheduleId}/runs`),
  // The caller's own chat threads with an agent, newest first.
  listAiAgentThreads: (teamKey: string, agentId: string) =>
    request<AiChatThread[]>(`/teams/${teamKey}/ai-agents/${agentId}/threads`),
  // The transcript of one chat thread, to restore the conversation.
  getAiAgentThreadMessages: (teamKey: string, agentId: string, threadId: string, page: number) =>
    request<AiChatMessagePage>(
      `/teams/${teamKey}/ai-agents/${agentId}/threads/${encodeURIComponent(threadId)}/messages?page=${page}`,
    ),
  deleteAiAgentThread: (teamKey: string, agentId: string, threadId: string) =>
    request<void>(
      `/teams/${teamKey}/ai-agents/${agentId}/threads/${encodeURIComponent(threadId)}`,
      { method: 'DELETE' },
    ),

  // Integrations: stored credentials for LLM providers and tool integrations. The
  // secret is write-only — responses carry only a redacted view.
  listIntegrationCatalog: (teamKey: string) =>
    request<IntegrationMeta[]>(`/teams/${teamKey}/integrations/catalog`),
  listIntegrationModels: (teamKey: string, provider: string) =>
    request<ProviderModel[]>(
      `/teams/${teamKey}/integrations/models/${encodeURIComponent(provider)}`,
    ),
  listCredentials: (teamKey: string) =>
    request<IntegrationCredential[]>(`/teams/${teamKey}/integrations`),
  createCredential: (teamKey: string, input: NewCredentialInput) =>
    request<IntegrationCredential>(`/teams/${teamKey}/integrations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCredential: (teamKey: string, credentialId: string, patch: CredentialPatch) =>
    request<IntegrationCredential>(`/teams/${teamKey}/integrations/${credentialId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCredential: (teamKey: string, credentialId: string) =>
    request<void>(`/teams/${teamKey}/integrations/${credentialId}`, { method: 'DELETE' }),

  // Agent skills: the team skill library and the skills enabled on an agent.
  listSkills: (teamKey: string) => request<AgentSkill[]>(`/teams/${teamKey}/agent-skills`),
  getSkillMarkdown: (teamKey: string, skillId: string) =>
    request<{ markdown: string }>(`/teams/${teamKey}/agent-skills/${skillId}/markdown`),
  getSkillReferenceContent: (teamKey: string, skillId: string, path: string) =>
    request<{ content: string }>(
      `/teams/${teamKey}/agent-skills/${skillId}/references/content?path=${encodeURIComponent(path)}`,
    ),
  createSkill: (teamKey: string, input: NewSkillInput) =>
    request<AgentSkill>(`/teams/${teamKey}/agent-skills`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  discoverGithubSkills: (teamKey: string, url: string) =>
    request<GithubSkillCandidate[]>(`/teams/${teamKey}/agent-skills/github/discover`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  updateSkill: (teamKey: string, skillId: string, patch: SkillPatch) =>
    request<AgentSkill>(`/teams/${teamKey}/agent-skills/${skillId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSkill: (teamKey: string, skillId: string) =>
    request<void>(`/teams/${teamKey}/agent-skills/${skillId}`, { method: 'DELETE' }),
  // Multipart upload for a skill reference — see uploadAttachment for why request()
  // cannot be used.
  addSkillReference: async (teamKey: string, skillId: string, file: File): Promise<AgentSkill> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/teams/${teamKey}/agent-skills/${skillId}/references`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
    }
    return res.json();
  },
  updateSkillReferenceContent: (teamKey: string, skillId: string, path: string, content: string) =>
    request<AgentSkill>(`/teams/${teamKey}/agent-skills/${skillId}/references/content`, {
      method: 'PATCH',
      body: JSON.stringify({ path, content }),
    }),
  deleteSkillReference: (teamKey: string, skillId: string, path: string) =>
    request<AgentSkill>(
      `/teams/${teamKey}/agent-skills/${skillId}/references?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    ),
  listAgentSkills: (teamKey: string, agentId: string) =>
    request<AgentSkill[]>(`/teams/${teamKey}/ai-agents/${agentId}/skills`),
  setAgentSkills: (teamKey: string, agentId: string, skillIds: string[]) =>
    request<AgentSkill[]>(`/teams/${teamKey}/ai-agents/${agentId}/skills`, {
      method: 'PUT',
      body: JSON.stringify({ skillIds }),
    }),

  // Configured tools: a team's tools bound to a credential, and the tools enabled
  // on one agent. The tool catalog itself comes from the integrations catalog.
  listConfiguredTools: (teamKey: string) =>
    request<ConfiguredTool[]>(`/teams/${teamKey}/agent-tools`),
  createConfiguredTool: (teamKey: string, input: NewConfiguredToolInput) =>
    request<ConfiguredTool>(`/teams/${teamKey}/agent-tools`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteConfiguredTool: (teamKey: string, agentToolId: string) =>
    request<void>(`/teams/${teamKey}/agent-tools/${agentToolId}`, { method: 'DELETE' }),
  listAgentToolLinks: (teamKey: string, agentId: string) =>
    request<ConfiguredTool[]>(`/teams/${teamKey}/ai-agents/${agentId}/tool-configs`),
  setAgentTools: (teamKey: string, agentId: string, agentToolIds: string[]) =>
    request<ConfiguredTool[]>(`/teams/${teamKey}/ai-agents/${agentId}/tool-configs`, {
      method: 'PUT',
      body: JSON.stringify({ agentToolIds }),
    }),

  // Roles: a team's custom roles and the permission catalog behind the role
  // editor. Any member can list; create/update/delete are owner-only on the API.
  getPermissionCatalog: () => request<PermissionCatalog>('/permission-catalog'),
  listRoles: (teamKey: string) => request<Role[]>(`/teams/${teamKey}/roles`),
  createRole: (teamKey: string, input: { name: string; permissions: Permissions }) =>
    request<Role>(`/teams/${teamKey}/roles`, { method: 'POST', body: JSON.stringify(input) }),
  updateRole: (
    teamKey: string,
    roleId: string,
    patch: { name?: string; permissions?: Permissions },
  ) =>
    request<Role>(`/teams/${teamKey}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteRole: (teamKey: string, roleId: string) =>
    request<void>(`/teams/${teamKey}/roles/${roleId}`, { method: 'DELETE' }),

  // Invites — owner side: create, list, and revoke a team's invite links.
  listInvites: (teamKey: string) => request<InviteRow[]>(`/teams/${teamKey}/invites`),
  createInvite: (
    teamKey: string,
    input: { email: string; role: MemberRole; roleId?: string | null },
  ) =>
    request<InviteRow>(`/teams/${teamKey}/invites`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteInvite: (teamKey: string, inviteId: string) =>
    request<void>(`/teams/${teamKey}/invites/${inviteId}`, { method: 'DELETE' }),

  // Invites — invitee side: open a link by token, then accept or reject it. The
  // session email must match the invite. Accept returns where to go next.
  getInvite: (token: string) => request<InviteView>(`/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ teamKey: string; teamName: string; role: MemberRole }>(
      `/invites/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    ),
  rejectInvite: (token: string) =>
    request<void>(`/invites/${encodeURIComponent(token)}/reject`, { method: 'POST' }),

  listActions: (teamKey: string) => request<ActionDef[]>(`/teams/${teamKey}/actions`),
  createAction: (teamKey: string, input: NewActionInput) =>
    request<ActionDef>(`/teams/${teamKey}/actions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAction: (actionId: string, patch: ActionPatch) =>
    request<ActionDef>(`/actions/${actionId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAction: (actionId: string) => request<void>(`/actions/${actionId}`, { method: 'DELETE' }),
  reorderActions: (teamKey: string, orderedIds: string[]) =>
    request<ActionDef[]>(`/teams/${teamKey}/actions/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),

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
  // All-teams webhooks: the god user or an owner of every team (403 otherwise).
  listAllTeamsWebhooks: () => request<Webhook[]>('/webhooks'),
  createAllTeamsWebhook: (input: NewWebhookInput) =>
    request<Webhook>('/webhooks', { method: 'POST', body: JSON.stringify(input) }),
  listWebhookDeliveries: (webhookId: string, before?: string) =>
    request<WebhookDeliveryPage>(
      `/webhooks/${webhookId}/deliveries?limit=25${before ? `&before=${before}` : ''}`,
    ),

  // Team settings: MCP reachability and auto-archive thresholds. Any member
  // reads; owner writes. The PATCH takes only the fields being changed.
  getTeamSettings: (teamKey: string) => request<TeamSettings>(`/teams/${teamKey}/settings`),
  updateTeamSettings: (
    teamKey: string,
    patch: {
      mcpEnabled?: boolean;
      features?: Partial<TeamFeatures>;
      autoArchive?: AutoArchiveSettings;
    },
  ) =>
    request<TeamSettings>(`/teams/${teamKey}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Notification provider credentials (danger_zone: read to view, edit to change).
  getNotificationSettings: (teamKey: string) =>
    request<NotificationSettings>(`/teams/${teamKey}/notification-settings`),
  setNotificationSettings: (teamKey: string, input: NotificationSettingsPatch) =>
    request<NotificationSettings>(`/teams/${teamKey}/notification-settings`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // The session member's own notification preferences for a team (any member).
  getNotificationPreferences: (teamKey: string) =>
    request<NotificationPreferences>(`/teams/${teamKey}/notification-preferences`),
  setNotificationPreferences: (teamKey: string, input: NotificationPreferences) =>
    request<NotificationPreferences>(`/teams/${teamKey}/notification-preferences`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // The session user's own Telegram account link. Starting a link returns the bot
  // deep link that completes it; the bot service writes the connection when the user
  // opens it.
  getTelegramAccount: () => request<TelegramAccount>('/telegram/account'),
  startTelegramLink: () => request<TelegramLinkStart>('/telegram/account/link', { method: 'POST' }),
  unlinkTelegramAccount: () => request<void>('/telegram/account', { method: 'DELETE' }),

  // The session user's own interface preferences, held per account. A read returns
  // the defaults when nothing was saved; a write patches only the fields it carries.
  getAccountPreferences: () => request<AccountPreferences>('/account/preferences'),
  updateAccountPreferences: (input: AccountPreferencesPatch) =>
    request<AccountPreferences>('/account/preferences', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  // Inbox notifications. The list is the session user's own; teamId scopes it to
  // one team (the per-team inbox). cursor is the JSON-encoded keyset from the
  // previous page.
  listNotifications: (
    teamId: string,
    params: {
      cursor?: NotificationCursor | null;
      limit?: number;
      filters?: NotificationFilters;
    } = {},
  ) => {
    const q = new URLSearchParams();
    q.set('teamId', String(teamId));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.cursor) q.set('cursor', JSON.stringify(params.cursor));
    const f = params.filters ?? {};
    if (f.types?.length) q.set('types', f.types.join(','));
    if (f.from) q.set('from', f.from);
    if (f.includeRead === false) q.set('includeRead', 'false');
    if (f.includeSnoozed) q.set('includeSnoozed', 'true');
    return request<NotificationPage>(`/notifications?${q.toString()}`);
  },
  // Change marker + unread count for one team's inbox, for live refresh and the
  // sidebar badge.
  getNotificationsRev: (teamId: string) =>
    request<{ rev: string; unread: number }>(`/notifications/rev?teamId=${teamId}`),
  setNotificationRead: (id: string, read: boolean) =>
    request<void>(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({ read }) }),
  snoozeNotification: (id: string, until: string | null) =>
    request<void>(`/notifications/${id}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ until }),
    }),
  markAllNotificationsRead: (teamId: string) =>
    request<{ count: number }>(`/notifications/read-all`, {
      method: 'POST',
      body: JSON.stringify({ teamId }),
    }),
  deleteNotification: (id: string) => request<void>(`/notifications/${id}`, { method: 'DELETE' }),
  deleteNotifications: (scope: NotificationDeleteScope, teamId: string) =>
    request<{ count: number }>(`/notifications?scope=${scope}&teamId=${teamId}`, {
      method: 'DELETE',
    }),

  // Instance administration (god mode). Every route below is owner-only; a plain
  // user gets a 403, which is why the entries are hidden from the sidebar.
  getInstanceAuthSettings: () => request<InstanceAuthSettings>('/god/auth-settings'),
  updateInstanceAuthSettings: (patch: InstanceAuthSettingsPatch) =>
    request<InstanceAuthSettings>('/god/auth-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  getInstanceEmailSettings: () => request<InstanceEmailSettings>('/god/email-settings'),
  updateInstanceEmailSettings: (patch: InstanceEmailSettingsPatch) =>
    request<InstanceEmailSettings>('/god/email-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  getInstanceTelegramSettings: () => request<InstanceTelegramSettings>('/god/telegram-settings'),
  updateInstanceTelegramSettings: (patch: InstanceTelegramSettingsPatch) =>
    request<InstanceTelegramSettings>('/god/telegram-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // The upload limits. The read is open to any signed-in user (the upload UI shows
  // the limit); the write is god mode.
  getStorageSettings: () => request<StorageSettings>('/settings/storage'),

  // The instance keyboard shortcuts. The read is open to any signed-in user (every
  // client applies them); the write is god mode.
  getHotkeySettings: () => request<HotkeyOverrides>('/settings/hotkeys'),
  getInstanceHotkeySettings: () => request<HotkeyOverrides>('/god/hotkey-settings'),
  updateInstanceHotkeySettings: (combos: HotkeyOverrides) =>
    request<HotkeyOverrides>('/god/hotkey-settings', {
      method: 'PUT',
      body: JSON.stringify(combos),
    }),

  // The running version, shown in the sidebar to every signed-in user.
  getAppVersion: () => request<{ version: string }>('/settings/version'),

  // Whether a newer release exists, and the release notes behind it. God mode: the
  // instance owner is the one who upgrades.
  getUpdateStatus: () => request<UpdateStatus>('/god/updates'),
  checkForUpdates: () => request<UpdateStatus>('/god/updates/check', { method: 'POST' }),

  getInstanceStorageSettings: () => request<StorageSettings>('/god/storage-settings'),
  updateInstanceStorageSettings: (patch: StorageSettingsPatch) =>
    request<StorageSettings>('/god/storage-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  getInstanceGoogleSettings: () => request<InstanceGoogleSettings>('/god/google-settings'),
  updateInstanceGoogleSettings: (patch: InstanceGoogleSettingsPatch) =>
    request<InstanceGoogleSettings>('/god/google-settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  // The instance user directory: one page of accounts, and one account with the
  // teams it can reach. Search, the kind filter and paging all run on the server.
  listInstanceUsers: (params: {
    search?: string;
    kind: InstanceUserKind;
    limit: number;
    offset: number;
  }) => {
    const query = new URLSearchParams({
      kind: params.kind,
      limit: String(params.limit),
      offset: String(params.offset),
    });
    if (params.search) query.set('search', params.search);
    return request<InstanceUserPage>(`/god/users?${query.toString()}`);
  },
  getInstanceUser: (userId: string) => request<InstanceUserDetail>(`/god/users/${userId}`),
  verifyInstanceUserEmail: (userId: string) =>
    request<InstanceUserDetail>(`/god/users/${userId}/verify-email`, { method: 'POST' }),
  // `withTeams` takes down the teams the user owns alone; without it the API
  // refuses to delete an account that would leave a team ownerless.
  deleteInstanceUser: (userId: string, withTeams: boolean) =>
    request<void>(`/god/users/${userId}${withTeams ? '?withTeams=true' : ''}`, {
      method: 'DELETE',
    }),
  // The instance team directory: one page of teams, and one team with its
  // members. Search and paging run on the server.
  listInstanceTeams: (params: { search?: string; limit: number; offset: number }) => {
    const query = new URLSearchParams({
      limit: String(params.limit),
      offset: String(params.offset),
    });
    if (params.search) query.set('search', params.search);
    return request<InstanceTeamPage>(`/god/teams?${query.toString()}`);
  },
  getInstanceTeam: (teamId: string) => request<InstanceTeamDetail>(`/god/teams/${teamId}`),
  // The instance's own sign-in policy, readable without a session: the sign-up
  // screen needs it before an account exists.
  getAuthConfig: () => request<PublicAuthConfig>('/auth-config'),
};
