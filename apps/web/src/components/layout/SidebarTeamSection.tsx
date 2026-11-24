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
} from '@/components/ui/sidebar';

// Whether a team entry is the current page. Issues covers the team root, its saved
// views and its issue pages; Projects is the projects list filtered to the team.
function isActive(key: string, href: string, pathname: string, teamKey: string, query: string) {
  const root = teamPath(teamKey);
  if (key === 'issues') {
    return (
      pathname === root ||
      pathname.startsWith(`${root}/view`) ||
      pathname.startsWith(`${root}/issue`)
    );
  }
  if (key === 'projects') return pathname === '/projects' && query === `team=${teamKey}`;
  return pathname.startsWith(href);
}

// One team in "Your teams": the team's name folds open to its Issues, Cycles and
// Projects. A team opens by default when the current page belongs to it.
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
  const { team, items } = section;
  return (
    <Collapsible asChild defaultOpen={current} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={team.name}>
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[10px] font-semibold">
              {team.key.slice(0, 2)}
            </span>
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
