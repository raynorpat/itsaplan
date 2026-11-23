import { usePathname } from 'next/navigation';
import { Inbox, SquareKanban } from 'lucide-react';
import { inboxPath, teamPath } from '@/utils/paths';
import { useInboxUnread } from '@/services/notifications.service';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The main sidebar group: the workspace Inbox and the team's Work items.
export default function SidebarWorkNav({ teamKey }: { teamKey: string | null }) {
  const pathname = usePathname();
  const disabled = !teamKey;
  const inboxUnread = useInboxUnread();

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
            href={inboxPath()}
            icon={Inbox}
            label="Inbox"
            active={pathname === inboxPath()}
            badge={inboxUnread}
          />
          <SidebarNavItem
            href={teamKey ? teamPath(teamKey) : '#'}
            icon={SquareKanban}
            label="Work items"
            active={onWorkItems}
            disabled={disabled}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
