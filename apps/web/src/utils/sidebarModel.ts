import type { Team } from '@/types/team';
import type { WorkspaceRole } from '@/types/workspace';
import { canSeeInitiatives } from '@/utils/workspaceRoles';
import {
  cyclesPath,
  inboxPath,
  initiativesPath,
  myIssuesPath,
  projectsPath,
  teamPath,
  teamViewsPath,
  viewsPath,
} from '@/utils/paths';

export interface SidebarItem {
  key: string;
  label: string;
  href: string;
}

export interface SidebarTeamSection {
  team: Team;
  items: SidebarItem[];
}

export interface SidebarModel {
  top: SidebarItem[];
  workspace: SidebarItem[];
  teams: SidebarTeamSection[];
}

// The workspace-first sidebar, as in Linear: Inbox and My issues, the workspace
// section, then one section per team the viewer joined. Teams the viewer can see
// without being a member stay on the teams page.
export function sidebarModel({
  workspaceRole,
  teams,
}: {
  workspaceRole: WorkspaceRole | null;
  teams: Team[];
}): SidebarModel {
  const workspace: SidebarItem[] = [
    { key: 'projects', label: 'Projects', href: projectsPath() },
    { key: 'views', label: 'Views', href: viewsPath() },
  ];
  if (canSeeInitiatives(workspaceRole)) {
    workspace.push({ key: 'initiatives', label: 'Initiatives', href: initiativesPath() });
  }
  return {
    top: [
      { key: 'inbox', label: 'Inbox', href: inboxPath() },
      { key: 'my-issues', label: 'My issues', href: myIssuesPath() },
    ],
    workspace,
    teams: teams
      .filter((t) => t.role != null)
      .map((team) => {
        const items: SidebarItem[] = [{ key: 'issues', label: 'Issues', href: teamPath(team.key) }];
        if (team.cyclesEnabled) {
          items.push({ key: 'cycles', label: 'Cycles', href: cyclesPath(team.key) });
        }
        items.push({ key: 'projects', label: 'Projects', href: projectsPath(team.key) });
        items.push({ key: 'views', label: 'Views', href: teamViewsPath(team.key) });
        return { team, items };
      }),
  };
}
