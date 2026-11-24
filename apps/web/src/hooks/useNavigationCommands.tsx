import { useRouter } from 'next/navigation';
import {
  AppWindow,
  Bell,
  CircleUserRound,
  FolderKanban,
  Inbox,
  Server,
  Settings,
  Settings2,
  SquareKanban,
  Tags,
  Target,
  Users,
} from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import {
  workspaceSettingsPath,
  workspaceApplicationsPath,
  inboxPath,
  myIssuesPath,
  settingsHomePath,
  projectLabelsSettingsPath,
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
// permission gate), the account pages and the workspace settings (none for guests,
// General and Applications for owners and admins). Grouped under one "Sections"
// heading so a search separates them from commands and issues.
export function useNavigationCommands(teamKey: string | null): CommandSection | null {
  const router = useRouter();
  const { data: session } = useSession();
  const { groups } = useSettingsNavGroups(teamKey);
  const role = toWorkspaceRole(session?.user.workspaceRole);
  const isAdmin = isWorkspaceAdmin(role);
  const isGuest = role === 'guest';

  const items: Command[] = [];

  function add(id: string, label: string, icon: Command['icon'], href: string, keywords?: string) {
    items.push({ id, label, icon, keywords, run: () => router.push(href) });
  }

  add('nav.inbox', 'Go to Inbox', <Inbox />, inboxPath(), 'notifications unread');
  add('nav.my-issues', 'Go to My issues', <CircleUserRound />, myIssuesPath(), 'assigned created');
  add('nav.projects', 'Projects', <Target />, projectsPath(), 'epics roadmap');
  add('nav.settings', 'Open settings', <Settings />, settingsHomePath(), 'preferences account');

  if (teamKey) {
    const key = teamKey;
    add('nav.work-items', 'Issues', <SquareKanban />, teamPath(key), 'board issues kanban');
    add('nav.members', 'Members', <Users />, membersPath(key), 'team people invite');
    add('nav.notifications', 'Notification preferences', <Bell />, notificationsPath(), 'email');
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
  }

  add('nav.manage-teams', 'Browse teams', <FolderKanban />, manageTeamsPath(), 'join leave delete');
  if (!isGuest) {
    add(
      'nav.workspace-members',
      'Workspace members',
      <Users />,
      workspaceMembersPath(),
      'invite people roles suspend',
    );
    add('nav.mcp', 'MCP Server', <Server />, mcpServerPath(), 'model context protocol');
    add('nav.project-labels', 'Project labels', <Tags />, projectLabelsSettingsPath(), 'tags');
  }
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
    add(
      'nav.applications',
      'Applications',
      <AppWindow />,
      workspaceApplicationsPath(),
      'oauth apps integrations',
    );
  }

  if (items.length === 0) return null;
  return { id: 'sections', heading: 'Sections', items };
}
