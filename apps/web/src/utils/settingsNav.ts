import type { Team } from '@/types/team';
import type { WorkspaceRole } from '@/types/workspace';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';

export interface SettingsNavItem {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

export interface SettingsNav {
  account: SettingsNavItem[];
  workspace: SettingsNavItem[];
  // The teams listed under Teams: the ones the viewer joined, plus the team the URL
  // names when the viewer opened the settings of a team they only see.
  teams: Team[];
  activeTeamKey: string | null;
}

const ACCOUNT: [string, string][] = [
  ['profile', 'Profile'],
  ['preferences', 'Preferences'],
  ['notifications', 'Notifications'],
  ['accounts', 'Accounts'],
  ['security', 'Security'],
  ['api-keys', 'API keys'],
  ['authorized-apps', 'Authorized apps'],
  ['teams', 'Teams'],
];

// [slug, label, owners and admins only]
const WORKSPACE: [string, string, boolean][] = [
  ['general', 'General', true],
  ['members', 'Members', false],
  ['applications', 'Applications', true],
  ['mcp', 'MCP', false],
  ['project-labels', 'Project labels', false],
];

// The Settings area's sidebar, as in Linear: the account pages, the workspace pages
// (General and Applications for owners and admins only), then the teams.
export function settingsNav({
  workspaceRole,
  teams,
  pathname,
}: {
  workspaceRole: WorkspaceRole | null;
  teams: Team[];
  pathname: string;
}): SettingsNav {
  const item = (base: string, slug: string, label: string): SettingsNavItem => {
    const href = `/settings/${base}/${slug}`;
    return { key: slug, label, href, active: pathname === href };
  };
  const admin = workspaceRole != null && isWorkspaceAdmin(workspaceRole);
  const segs = pathname.split('/').filter(Boolean);
  const activeTeamKey = segs[1] === 'teams' ? (segs[2] ?? null) : null;
  return {
    account: ACCOUNT.map(([slug, label]) => item('account', slug, label)),
    workspace: WORKSPACE.filter(([, , adminOnly]) => !adminOnly || admin).map(([slug, label]) =>
      item('workspace', slug, label),
    ),
    teams: teams.filter((t) => t.role != null || t.key === activeTeamKey),
    activeTeamKey,
  };
}
