import { usePathname } from 'next/navigation';
import { Bell, Settings, Users } from 'lucide-react';
import { membersPath, notificationsPath } from '@/utils/paths';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The Configuration sidebar group: Members, Notifications and the "Team
// settings" entry. That entry links to the first settings section the viewer may
// read and switches the sidebar into settings mode (see AppSidebar).
export default function SidebarConfigNav({ teamKey }: { teamKey: string | null }) {
  const pathname = usePathname();
  const disabled = !teamKey;
  const { firstHref } = useSettingsNavGroups(teamKey);

  const onRoles = pathname.endsWith('/members/roles');

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Configuration</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarNavItem
            href={teamKey ? membersPath(teamKey) : '#'}
            icon={Users}
            label="Members"
            active={pathname.includes('/members') && !onRoles}
            disabled={disabled}
          />
          <SidebarNavItem
            href={teamKey ? notificationsPath(teamKey) : '#'}
            icon={Bell}
            label="Notifications"
            active={!!teamKey && pathname === notificationsPath(teamKey)}
            disabled={disabled}
          />
          {firstHref && (
            <SidebarNavItem
              href={firstHref}
              icon={Settings}
              label="Team settings"
              active={false}
              disabled={disabled}
            />
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
