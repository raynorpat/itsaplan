import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Team } from '@/types/team';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { membersPath, teamSettingsPath } from '@/utils/paths';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import SidebarTeamBadge from '@/components/layout/SidebarTeamBadge';

// One team under Teams in the Settings sidebar. The open team lists its members and
// the sections the viewer may read; the others link to their settings, which open
// on the first of them.
export default function SidebarSettingsTeam({ team, open }: { team: Team; open: boolean }) {
  const pathname = usePathname();
  const { groups } = useSettingsNavGroups(open ? team.key : null);
  const members = membersPath(team.key);
  const items = [
    { key: 'members', label: 'Members', href: members, active: pathname === members },
    ...groups.flatMap((g) => g.items),
  ];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={team.name}>
        <Link href={teamSettingsPath(team.key)}>
          <SidebarTeamBadge teamKey={team.key} />
          <span className="truncate">{team.name}</span>
        </Link>
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {items.map((item) => (
            <SidebarMenuSubItem key={item.key}>
              <SidebarMenuSubButton asChild isActive={item.active}>
                <Link href={item.href}>{item.label}</Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
