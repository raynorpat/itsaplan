// Path builders for the planner routes. The team, the open view and the open
// settings section live in the URL, so these are the single source of truth —
// see the app/team/[teamKey] route tree.
import type { StartPage } from '@/lib/api';

export const teamPath = (key: string) => `/team/${encodeURIComponent(key)}`;

export const viewPath = (key: string, viewId: string | null) =>
  viewId != null ? `${teamPath(key)}/view/${viewId}` : teamPath(key);

export const settingsPath = (key: string, section: string) =>
  `${teamPath(key)}/settings/${section}`;

export const inboxPath = (key: string) => `${teamPath(key)}/inbox`;

// The member's own notification preferences (which events are sent by email). A
// main-nav Configuration destination, open to any member.
export const notificationsPath = (key: string) => `${teamPath(key)}/notifications`;

export const mcpServerPath = (key: string) => `${teamPath(key)}/mcp`;

export const apiDocsPath = (key: string) => `${teamPath(key)}/api`;

export const membersPath = (key: string) => `${teamPath(key)}/members`;

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
    case 'projects':
      return projectsPath(key);
    default:
      return teamPath(key);
  }
};

// The standalone Manage teams page (outside the team shell), reached from
// the team switcher. Lists every team the user belongs to and lets an owner
// delete one.
export const manageTeamsPath = () => '/account/teams';
export const workspaceMembersPath = () => '/workspace/members';

// The invitee-facing link an owner shares. Points at this web app's public
// /invite/:token page, which reads the token and shows the accept screen.
export const inviteLink = (origin: string, token: string) => `${origin}/invite/${token}`;

// Workspace settings (Linear's Organization), for owners and admins.
export const workspaceSettingsPath = () => '/workspace/settings';
