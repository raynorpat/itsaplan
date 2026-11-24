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
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { ACCOUNT_SECTIONS } from '@/utils/accountSections';
import { membersPath, teamSettingsPath } from '@/utils/paths';
import { settingsNav, type SettingsNavItem } from '@/utils/settingsNav';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

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

function NavGroup({ label, items }: { label: string; items: SettingsNavItem[] }) {
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarNavItem
              key={item.key}
              href={item.href}
              icon={ICONS[item.key] ?? Settings2}
              label={item.label}
              active={item.active}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// The open team's settings pages: its members, then the sections the viewer may
// read. The other teams link to their settings, which open on the first of them.
function TeamSettingsItems({ team, open }: { team: Team; open: boolean }) {
  const pathname = usePathname();
  const { groups } = useSettingsNavGroups(open ? team.key : null);
  if (!open) {
    return (
      <SidebarNavItem
        href={teamSettingsPath(team.key)}
        icon={SquareStack}
        label={team.name}
        active={false}
      />
    );
  }
  const members = membersPath(team.key);
  return (
    <>
      <SidebarNavItem
        href={teamSettingsPath(team.key)}
        icon={SquareStack}
        label={team.name}
        active={false}
      />
      <div className="ml-3 border-l pl-2">
        <SidebarNavItem href={members} icon={Users} label="Members" active={pathname === members} />
        {groups.flatMap((g) =>
          g.items.map((item) => (
            <SidebarNavItem
              key={item.key}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={item.active}
            />
          )),
        )}
      </div>
    </>
  );
}

// The Settings area's sidebar, as Linear's: back to the app, then the account pages,
// the workspace pages and the teams.
export default function SidebarSettingsNav({ teams }: { teams: Team[] }) {
  const pathname = usePathname();
  const workspaceRole = useViewerWorkspaceQuery().data?.workspaceRole ?? null;
  const nav = settingsNav({ workspaceRole, teams, pathname });

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarNavItem href="/" icon={ArrowLeft} label="Back to app" active={false} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <NavGroup label="Account" items={nav.account} />
      <NavGroup label="Workspace" items={nav.workspace} />
      {nav.teams.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Teams</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.teams.map((team) => (
                <TeamSettingsItems
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
