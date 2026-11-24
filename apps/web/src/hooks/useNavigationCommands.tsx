import { useRouter } from 'next/navigation';
import {
  Bell,
  FolderKanban,
  Inbox,
  Server,
  Settings2,
  SquareKanban,
  Target,
  Users,
} from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import {
  workspaceSettingsPath,
  inboxPath,
  projectsPath,
  manageTeamsPath,
  workspaceMembersPath,
  mcpServerPath,
  membersPath,
  notificationsPath,
  teamPath,
} from '@/utils/paths';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import type { Command, CommandSection } from '@/utils/commands';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';

// Every place the palette can navigate to; the settings destinations are filtered
// by what the viewer may read.
// The destinations mirror the sidebars one-to-one: the main nav (SidebarMainNav),
// the team settings nav (useSettingsNavGroups, which already applies the
// permission gate), the sidebar footer, the account pages and workspace settings. Grouped
// under one "Sections" heading so a search separates them from commands and
// issues.
export function useNavigationCommands(teamKey: string | null): CommandSection | null {
  const router = useRouter();
  const { data: session } = useSession();
  const { groups } = useSettingsNavGroups(teamKey);
  const isAdmin = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));

  const items: Command[] = [];

  function add(id: string, label: string, icon: Command['icon'], href: string, keywords?: string) {
    items.push({ id, label, icon, keywords, run: () => router.push(href) });
  }

  if (teamKey) {
    const key = teamKey;
    add('nav.inbox', 'Inbox', <Inbox />, inboxPath(), 'notifications unread');
    add('nav.work-items', 'Issues', <SquareKanban />, teamPath(key), 'board issues kanban');
    add('nav.projects', 'Projects', <Target />, projectsPath(), 'epics roadmap');
    add('nav.members', 'Members', <Users />, membersPath(key), 'team people invite');
    add('nav.notifications', 'Notification preferences', <Bell />, notificationsPath(key), 'email');
    // The settings destinations, already permission-filtered by the hook the
    // settings sidebar uses. The group label is a keyword so "workflow" or
    // "automation" finds its sections.
    for (const group of groups) {
      for (const item of group.items) {
        items.push({
          id: `nav.settings.${item.key}`,
          label: item.label,
          icon: <item.icon />,
          keywords: `settings ${group.label}`,
          run: () => router.push(item.href),
        });
      }
    }
    add('nav.mcp', 'MCP Server', <Server />, mcpServerPath(key), 'model context protocol');
  }

  add('nav.manage-teams', 'Browse teams', <FolderKanban />, manageTeamsPath(), 'join leave delete');
  add(
    'nav.workspace-members',
    'Workspace members',
    <Users />,
    workspaceMembersPath(),
    'invite people roles suspend',
  );
  for (const s of ACCOUNT_SECTIONS) {
    add(`nav.account.${s.slug}`, s.label, <s.icon />, accountPath(s.slug), 'account');
  }

  // Workspace settings, owners and admins only. The API enforces the same, so
  // hiding it here is about noise, not access.
  if (isAdmin) {
    add(
      'nav.workspace-settings',
      'Workspace settings',
      <Settings2 />,
      workspaceSettingsPath(),
      'organization sign-in domains uploads',
    );
  }

  if (items.length === 0) return null;
  return { id: 'sections', heading: 'Sections', items };
}
