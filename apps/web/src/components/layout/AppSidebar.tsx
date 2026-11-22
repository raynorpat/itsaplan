'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Braces, Server, Shield } from 'lucide-react';
import type { Team } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { apiDocsPath, godPath, mcpServerPath } from '@/utils/paths';
import { GOD_SECTIONS } from '@/utils/godSections';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import TeamSwitcher from '@/components/layout/TeamSwitcher';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarMainNav from '@/components/layout/SidebarMainNav';
import SidebarSettingsNav from '@/components/layout/SidebarSettingsNav';
import SidebarBrandFooter from '@/components/brand/SidebarBrandFooter';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';

// The app sidebar. It has two modes driven by the route: the main work
// navigation, and the team settings navigation reached through the "Team
// settings" entry. The team switcher header and the footer (API docs, MCP
// server, brand mark) are shared by both modes. Team deletion lives on the
// standalone Manage teams page, not here.
export default function AppSidebar({
  teams,
  currentTeamKey,
  onSelectTeam,
  onNewTeam,
}: {
  teams: Team[];
  currentTeamKey: string | null;
  onSelectTeam: (key: string) => void;
  onNewTeam: () => void;
}) {
  const pathname = usePathname();
  const disabled = !currentTeamKey;
  const teamId = teams.find((p) => p.key === currentTeamKey)?.id ?? null;

  const { data: session } = useSession();
  // The session store can already be filled by the time React hydrates, while the
  // server rendered without it. Reading it only after mount keeps the server and
  // the first client render identical, so the God mode entry does not break
  // hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));

  // Settings mode is on whenever the route matches one of the settings nav items.
  // Members is not in those groups, so it keeps the main sidebar.
  const settingsNav = useSettingsNavGroups(currentTeamKey);
  const settingsMode = settingsNav.groups.some((g) => g.items.some((i) => i.active));
  const onApiDocs = pathname.endsWith('/api');
  const onMcp = pathname.endsWith('/mcp');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <TeamSwitcher
          teams={teams}
          currentTeamKey={currentTeamKey}
          onSelectTeam={onSelectTeam}
          onNewTeam={onNewTeam}
        />
      </SidebarHeader>

      <SidebarContent>
        {settingsMode ? (
          <SidebarSettingsNav teamKey={currentTeamKey} />
        ) : (
          <SidebarMainNav teamKey={currentTeamKey} teamId={teamId} />
        )}
      </SidebarContent>

      <SidebarFooter>
        {!settingsMode && (
          <>
            <SidebarMenu>
              <SidebarNavItem
                href={currentTeamKey ? apiDocsPath(currentTeamKey) : '#'}
                icon={Braces}
                label="API docs"
                active={onApiDocs}
                disabled={disabled}
              />
              <SidebarNavItem
                href={currentTeamKey ? mcpServerPath(currentTeamKey) : '#'}
                icon={Server}
                label="MCP Server"
                active={onMcp}
                disabled={disabled}
              />
              {/* Instance administration, only for the owner account. The API
                  enforces the same, so hiding it here is about noise, not access. */}
              {isGod && (
                <SidebarNavItem
                  href={godPath(GOD_SECTIONS[0]!.slug)}
                  icon={Shield}
                  label="God mode"
                  active={false}
                  disabled={false}
                />
              )}
            </SidebarMenu>

            <SidebarSeparator />
          </>
        )}

        <SidebarBrandFooter />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
