'use client';

import { usePathname } from 'next/navigation';
import type { Team } from '@/types/team';
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
// new-issue buttons on top, then the main navigation. In the Settings area the body
// switches to the settings navigation.
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
  // The Settings area (/settings/…) shows the settings navigation instead.
  const settingsMode = usePathname().startsWith('/settings');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <WorkspaceMenu onNewTeam={onNewTeam} />
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
          <SidebarSettingsNav teams={teams} />
        ) : (
          <SidebarMainNav teams={teams} teamKey={currentTeamKey} />
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
