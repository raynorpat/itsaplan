import { usePathname } from 'next/navigation';
import { Inbox, SquareKanban } from 'lucide-react';
import { inboxPath, teamPath } from '@/utils/paths';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

// The team's sidebar group: Inbox and Work items.
export default function SidebarWorkNav({
  teamKey,
  teamId,
}: {
  teamKey: string | null;
  teamId: string | null;
}) {
  const pathname = usePathname();
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
