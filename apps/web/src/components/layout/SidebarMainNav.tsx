import { usePathname, useSearchParams } from 'next/navigation';
import {
  CircleUserRound,
  Inbox,
  Layers,
  MessageSquareQuote,
  Milestone,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { Team } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import { useInboxUnread } from '@/services/notifications.service';
import { sidebarModel } from '@/utils/sidebarModel';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarTeamSection from '@/components/layout/SidebarTeamSection';
import SidebarTrySection from '@/components/layout/SidebarTrySection';

const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  'my-issues': CircleUserRound,
  projects: Target,
  views: Layers,
  initiatives: Milestone,
  feedback: MessageSquareQuote,
};

// The main sidebar body, workspace-first as in Linear: Inbox and My issues, the
// Workspace group, "Your teams" with one folding section per joined team, and the
// "Try" section at the bottom.
export default function SidebarMainNav({
  teams,
  teamKey,
}: {
  teams: Team[];
  teamKey: string | null;
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const { workspaceRole } = usePermissions();
  const inboxUnread = useInboxUnread();
  const model = sidebarModel({ workspaceRole, teams });

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {model.top.map((item) => (
              <SidebarNavItem
                key={item.key}
                href={item.href}
                icon={ICONS[item.key]}
                label={item.label}
                active={pathname === item.href}
                badge={item.key === 'inbox' ? inboxUnread : undefined}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {model.workspace.map((item) => (
              <SidebarNavItem
                key={item.key}
                href={item.href}
                icon={ICONS[item.key]}
                label={item.label}
                active={
                  pathname.startsWith(item.href) &&
                  !(item.key === 'projects' && query.startsWith('team='))
                }
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Your teams</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {model.teams.map((section) => (
              <SidebarTeamSection
                key={section.team.id}
                section={section}
                current={section.team.key === teamKey}
                query={query}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarTrySection />
    </>
  );
}
