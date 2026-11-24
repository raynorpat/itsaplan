import { usePathname } from 'next/navigation';
import {
  AppWindow,
  ArrowLeft,
  Bell,
  Server,
  Settings2,
  SquareStack,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Team } from '@/types/team';
import { useViewerWorkspaceQuery } from '@/services/viewer.service';
import { useBackToAppHref } from '@/hooks/useLastAppPath';
import { ACCOUNT_SECTIONS } from '@/utils/accountSections';
import { settingsNav } from '@/utils/settingsNav';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarSettingsGroup from '@/components/layout/SidebarSettingsGroup';
import SidebarSettingsTeam from '@/components/layout/SidebarSettingsTeam';

const ICONS: Record<string, LucideIcon> = {
  ...Object.fromEntries(ACCOUNT_SECTIONS.map((s) => [s.slug, s.icon])),
  notifications: Bell,
  teams: SquareStack,
  general: Settings2,
  members: Users,
  applications: AppWindow,
  mcp: Server,
  'project-labels': Tags,
};

// The Settings area's sidebar, as Linear's: back to the app, then the account pages,
// the workspace pages and the teams.
export default function SidebarSettingsNav({ teams }: { teams: Team[] }) {
  const pathname = usePathname();
  const workspaceRole = useViewerWorkspaceQuery().data?.workspaceRole ?? null;
  const nav = settingsNav({ workspaceRole, teams, pathname });
  const backHref = useBackToAppHref();

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarNavItem href={backHref} icon={ArrowLeft} label="Back to app" active={false} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarSettingsGroup label="Account" items={nav.account} icons={ICONS} />
      <SidebarSettingsGroup label="Workspace" items={nav.workspace} icons={ICONS} />
      {nav.teams.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Teams</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.teams.map((team) => (
                <SidebarSettingsTeam
                  key={team.id}
                  team={team}
                  open={team.key === nav.activeTeamKey}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
