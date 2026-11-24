'use client';

import type { Team } from '@/types/team';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import SidebarMainNav from '@/components/layout/SidebarMainNav';
import SidebarQuickActions from '@/components/layout/SidebarQuickActions';
import SidebarSettingsNav from '@/components/layout/SidebarSettingsNav';
import WorkspaceMenu from '@/components/layout/WorkspaceMenu';

// The app sidebar, workspace-first as in Linear: the workspace menu with search and
// new-issue buttons on top, then the main navigation. On a team settings page the
// body switches to the settings navigation.
export default function AppSidebar({
  teams,
  currentTeamKey,
  onNewTeam,
  onOpenCommand,
  onNewIssue,
  canCreateIssue,
}: {
  teams: Team[];
  currentTeamKey: string | null;
  onNewTeam: () => void;
  onOpenCommand: () => void;
  onNewIssue: () => void;
  canCreateIssue: boolean;
}) {
  // Settings mode is on whenever the route matches one of the settings nav items.
  const settingsNav = useSettingsNavGroups(currentTeamKey);
  const settingsMode = settingsNav.groups.some((g) => g.items.some((i) => i.active));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <WorkspaceMenu teamKey={currentTeamKey} onNewTeam={onNewTeam} />
            <SidebarQuickActions
              onOpenCommand={onOpenCommand}
              onNewIssue={onNewIssue}
              canCreateIssue={canCreateIssue}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {settingsMode ? (
          <SidebarSettingsNav teamKey={currentTeamKey} />
        ) : (
          <SidebarMainNav teams={teams} teamKey={currentTeamKey} />
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
