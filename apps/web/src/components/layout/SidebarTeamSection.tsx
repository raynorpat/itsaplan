import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { SidebarTeamSection as Section } from '@/utils/sidebarModel';
import { teamPath } from '@/utils/paths';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import SidebarTeamBadge from '@/components/layout/SidebarTeamBadge';

// Whether a team entry is the current page. Issues covers the team root, its saved
// views (/view/:id, not the /views list) and its issue pages; Projects is the
// projects list filtered to the team.
function isActive(key: string, href: string, pathname: string, teamKey: string, query: string) {
  const root = teamPath(teamKey);
  if (key === 'issues') {
    return (
      pathname === root ||
      pathname.startsWith(`${root}/view/`) ||
      pathname.startsWith(`${root}/issue`)
    );
  }
  if (key === 'projects') return pathname === '/projects' && query === `team=${teamKey}`;
  return pathname.startsWith(href);
}

// One team in "Your teams": the team's name folds open to its Issues, Cycles and
// Projects. A team opens when the current page comes to belong to it, and stays as
// the user left it otherwise. With the sidebar collapsed to icons the sub-items are
// hidden, so the team's badge links to its issues instead.
export default function SidebarTeamSection({
  section,
  current,
  query,
}: {
  section: Section;
  current: boolean;
  query: string;
}) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const { team, items } = section;
  const [open, setOpen] = useState(current);
  useEffect(() => {
    if (current) setOpen(true);
  }, [current]);

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={current} tooltip={team.name}>
          <Link href={teamPath(team.key)}>
            <SidebarTeamBadge teamKey={team.key} />
            <span className="truncate">{team.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={team.name}>
            <SidebarTeamBadge teamKey={team.key} />
            <span className="truncate">{team.name}</span>
            <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.key}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isActive(item.key, item.href, pathname, team.key, query)}
                >
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
