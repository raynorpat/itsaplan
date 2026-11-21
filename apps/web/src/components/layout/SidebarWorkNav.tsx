import { usePathname } from 'next/navigation';
import { Inbox, LayoutDashboard, SquareKanban, StickyNote } from 'lucide-react';
import { dashboardsPath, inboxPath, notesPath, teamPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeamFeatures } from '@/hooks/useTeamFeatures';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The team's sidebar group: Inbox, Dashboards, Work items, Notes.
export default function SidebarWorkNav({
  teamKey,
  teamId,
}: {
  teamKey: string | null;
  teamId: string | null;
}) {
  const pathname = usePathname();
  const { can } = usePermissions();
  const features = useTeamFeatures();
  const disabled = !teamKey;
  const { data: inboxUnread } = useInboxUnread(teamKey, teamId);

  // "Work items" is the default view: active on the team root and any segment
  // that is not one of the other top-level destinations.
  const onWorkItems =
    !!teamKey &&
    (pathname === teamPath(teamKey) ||
      pathname.startsWith(`${teamPath(teamKey)}/view`) ||
      pathname.startsWith(`${teamPath(teamKey)}/issue`));

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarNavItem
            href={teamKey ? inboxPath(teamKey) : '#'}
            icon={Inbox}
            label="Inbox"
            active={pathname.endsWith('/inbox')}
            disabled={disabled}
            badge={inboxUnread}
          />
          {features.dashboards && can('dashboards', 'read') && (
            <SidebarNavItem
              href={teamKey ? dashboardsPath(teamKey) : '#'}
              icon={LayoutDashboard}
              label="Dashboards"
              active={pathname.includes('/dashboard')}
              disabled={disabled}
            />
          )}
          <SidebarNavItem
            href={teamKey ? teamPath(teamKey) : '#'}
            icon={SquareKanban}
            label="Work items"
            active={onWorkItems}
            disabled={disabled}
          />
          {features.notes && (
            <SidebarNavItem
              href={teamKey ? notesPath(teamKey) : '#'}
              icon={StickyNote}
              label="Notes"
              active={pathname.includes('/notes')}
              disabled={disabled}
            />
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
