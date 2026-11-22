import { useRouter } from 'next/navigation';
import {
  Bell,
  Braces,
  FolderKanban,
  Inbox,
  Server,
  Shield,
  SquareKanban,
  Target,
  Users,
} from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import {
  apiDocsPath,
  godPath,
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
import { GOD_SECTIONS } from '@/utils/godSections';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import type { Command, CommandSection } from '@/utils/commands';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';

// Every place the palette can navigate to; the settings destinations are filtered
// by what the viewer may read.
// The destinations mirror the sidebars one-to-one: the main nav (SidebarMainNav),
// the team settings nav (useSettingsNavGroups, which already applies the
// permission gate), the sidebar footer, the account pages and god mode. Grouped
// under one "Sections" heading so a search separates them from commands and
// issues.
export function useNavigationCommands(teamKey: string | null): CommandSection | null {
  const router = useRouter();
  const { data: session } = useSession();
  const { groups } = useSettingsNavGroups(teamKey);
  const isGod = isWorkspaceAdmin(toWorkspaceRole(session?.user.workspaceRole));

  const items: Command[] = [];

  function add(id: string, label: string, icon: Command['icon'], href: string, keywords?: string) {
    items.push({ id, label, icon, keywords, run: () => router.push(href) });
  }

  if (teamKey) {
    const key = teamKey;
    add('nav.inbox', 'Inbox', <Inbox />, inboxPath(key), 'notifications unread');
    add('nav.work-items', 'Work items', <SquareKanban />, teamPath(key), 'board issues kanban');
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
    add('nav.api', 'API docs', <Braces />, apiDocsPath(key), 'rest openapi');
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

  // Instance administration, owner account only. The API enforces the same, so
  // hiding it here is about noise, not access.
  if (isGod) {
    for (const s of GOD_SECTIONS) {
      add(
        `nav.god.${s.slug}`,
        `God mode: ${s.label}`,
        <Shield />,
        godPath(s.slug),
        'instance admin',
      );
    }
  }

  if (items.length === 0) return null;
  return { id: 'sections', heading: 'Sections', items };
}
