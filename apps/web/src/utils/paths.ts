// Path builders for the planner routes. The team, the open view and the open
// settings section live in the URL, so these are the single source of truth —
// see the app/team/[teamKey] route tree.
import type { StartPage } from '@/lib/api';

export const teamPath = (key: string) => `/team/${encodeURIComponent(key)}`;

export const viewPath = (key: string, viewId: string | null) =>
  viewId != null ? `${teamPath(key)}/view/${viewId}` : teamPath(key);

export const dashboardsPath = (key: string) => `${teamPath(key)}/dashboard`;

// Public read-only share pages (no auth). The token is the unguessable share key.
export const shareIssuePath = (token: string) => `/share/issue/${token}`;
export const shareViewPath = (token: string) => `/share/view/${token}`;

// The absolute share URL to copy, built from the current origin at call time.
export const shareUrl = (path: string) =>
  typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

export const dashboardPath = (key: string, dashboardId: string) =>
  `${dashboardsPath(key)}/${dashboardId}`;

export const notesPath = (key: string) => `${teamPath(key)}/notes`;

export const notePath = (key: string, boardId: string) => `${notesPath(key)}/${boardId}`;

export const settingsPath = (key: string, section: string) =>
  `${teamPath(key)}/settings/${section}`;

// The AI Team destinations: the chat and the sections listed next to it in the
// main sidebar (see AI_TEAM_SECTIONS).
export const aiTeamPath = (key: string, section: string) => `${teamPath(key)}/ai-team/${section}`;

export const aiChatPath = (key: string) => aiTeamPath(key, 'chat');

export const inboxPath = (key: string) => `${teamPath(key)}/inbox`;

// The member's own notification preferences (which events, by which channel, their
// Telegram chat id). A main-nav Configuration destination, open to any member.
export const notificationsPath = (key: string) => `${teamPath(key)}/notifications`;

export const aiAgentsPath = (key: string) => `${teamPath(key)}/ai-agents`;

export const integrationsPath = (key: string) => `${teamPath(key)}/integrations`;

export const agentSkillsPath = (key: string) => `${teamPath(key)}/agent-skills`;

export const agentToolsPath = (key: string) => `${teamPath(key)}/agent-tools`;

export const mcpServerPath = (key: string) => `${teamPath(key)}/mcp`;

export const apiDocsPath = (key: string) => `${teamPath(key)}/api`;

export const membersPath = (key: string) => `${teamPath(key)}/members`;

export const rolesPath = (key: string) => `${teamPath(key)}/members/roles`;

// Issues are addressed in the URL by their team-scoped number (the "42" in
// "MKT-42"), not the internal database id: /team/MKT/issue/42.
export const issuePath = (key: string, sequenceNumber: number) =>
  `${teamPath(key)}/issue/${sequenceNumber}`;

// Projects live in the workspace-level Projects area (/projects), not under a
// team. `?team=KEY` filters the list to that team and picks the team whose issues
// a project page shows; omit it for every team.
const withTeam = (path: string, key?: string | null) =>
  key ? `${path}?team=${encodeURIComponent(key)}` : path;

export const projectsPath = (key?: string | null) => withTeam('/projects', key);

// The status tabs of the projects list are routes of their own, so a reload or a
// shared link reopens the tab the user was on. "All" is the tab at the list path;
// the page and the sorting stay in the query string.
const PROJECTS_TABS = ['all', 'backlog', 'planned', 'started', 'paused', 'completed'] as const;

export type ProjectsTab = (typeof PROJECTS_TABS)[number];

export const isProjectsTab = (value: string): value is ProjectsTab =>
  (PROJECTS_TABS as readonly string[]).includes(value);

export const projectsTabPath = (key: string | null | undefined, tab: ProjectsTab) =>
  tab === 'all' ? projectsPath(key) : withTeam(`/projects/tab/${tab}`, key);

// The project detail tabs are routes of their own too.
export type ProjectTab = 'overview' | 'issues';

export const projectPath = (
  key: string | null | undefined,
  projectId: string,
  tab: ProjectTab = 'overview',
) => withTeam(`/projects/${projectId}${tab === 'overview' ? '' : `/${tab}`}`, key);

export const projectLabelsSettingsPath = () => '/projects/settings/labels';

// Where the app root sends the user, from their start page preference. The section
// opens in the team they were last in (see app/page.tsx).
export const startPagePath = (key: string, startPage: StartPage) => {
  switch (startPage) {
    case 'inbox':
      return inboxPath(key);
    case 'dashboard':
      return dashboardsPath(key);
    case 'projects':
      return projectsPath(key);
    case 'ai-chat':
      return aiChatPath(key);
    default:
      return teamPath(key);
  }
};

// The standalone Manage teams page (outside the team shell), reached from
// the team switcher. Lists every team the user belongs to and lets an owner
// delete one.
export const manageTeamsPath = () => '/account/teams';

// The invitee-facing link an owner shares. Points at this web app's public
// /invite/:token page, which reads the token and shows the accept screen.
export const inviteLink = (origin: string, token: string) => `${origin}/invite/${token}`;

// God mode: instance administration, outside the team shell (see GOD_SECTIONS).
export const godPath = (section: string) => `/god/${section}`;
