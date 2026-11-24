'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AppWindow,
  Bell,
  ChevronDown,
  LogOut,
  Plus,
  Server,
  Settings,
  Settings2,
  SquareStack,
  Tags,
  Users,
} from 'lucide-react';
import { signOut, useSession } from '@/lib/auth-client';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { useAppVersionQuery } from '@/services/version.service';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import {
  manageTeamsPath,
  mcpServerPath,
  membersPath,
  notificationsPath,
  projectLabelsSettingsPath,
  workspaceApplicationsPath,
  workspaceMembersPath,
  workspaceSettingsPath,
} from '@/utils/paths';
import { isWorkspaceAdmin, toWorkspaceRole } from '@/utils/workspaceRoles';
import ItsAPlanMark from '@/components/brand/ItsAPlanMark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import WorkspaceMenuTheme from '@/components/layout/WorkspaceMenuTheme';

// The workspace menu at the top of the sidebar, as Linear's: settings, people and
// teams, the account pages, the theme, sign out and the running version. The
// settings links gather here until the Settings area exists.
export default function WorkspaceMenu({
  teamKey,
  onNewTeam,
}: {
  teamKey: string | null;
  onNewTeam: () => void;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: appVersion } = useAppVersionQuery();
  const { firstHref: teamSettingsHref } = useSettingsNavGroups(teamKey);
  // The session can already be cached when React hydrates while the server
  // rendered without it; reading it after mount keeps the first render identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = mounted ? session?.user : undefined;
  const isAdmin = !!user && isWorkspaceAdmin(toWorkspaceRole(user.workspaceRole));

  async function onSignOut() {
    await signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="w-auto min-w-0 flex-1 data-[state=open]:bg-sidebar-accent">
          <ItsAPlanMark className="size-5 shrink-0" />
          <span className="truncate font-medium">It&apos;s a Plan</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {user && (
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </DropdownMenuLabel>
        )}
        {teamSettingsHref && (
          <DropdownMenuItem asChild>
            <Link href={teamSettingsHref}>
              <Settings />
              Team settings
            </Link>
          </DropdownMenuItem>
        )}
        {teamKey && (
          <>
            <DropdownMenuItem asChild>
              <Link href={membersPath(teamKey)}>
                <Users />
                Team members
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={notificationsPath(teamKey)}>
                <Bell />
                Notifications
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={mcpServerPath(teamKey)}>
                <Server />
                MCP server
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {isAdmin && (
          <>
            <DropdownMenuItem asChild>
              <Link href={workspaceSettingsPath()}>
                <Settings2 />
                Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={workspaceApplicationsPath()}>
                <AppWindow />
                OAuth applications
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href={projectLabelsSettingsPath()}>
            <Tags />
            Project labels
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={workspaceMembersPath()}>
            <Users />
            Workspace members
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={manageTeamsPath()}>
            <SquareStack />
            Browse teams
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewTeam}>
          <Plus />
          New team
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ACCOUNT_SECTIONS.map(({ slug, label, icon: Icon }) => (
          <DropdownMenuItem key={slug} asChild>
            <Link href={accountPath(slug)}>
              <Icon />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
        <WorkspaceMenuTheme />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          It&apos;s a Plan {appVersion?.version ? `v${appVersion.version}` : ''}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
