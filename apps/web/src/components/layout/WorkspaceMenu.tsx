'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Plus, Settings, UserPlus } from 'lucide-react';
import { signOut, useSession } from '@/lib/auth-client';
import { useAppVersionQuery } from '@/services/version.service';
import { settingsHomePath, workspaceMembersPath } from '@/utils/paths';
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

// The workspace menu at the top of the sidebar, as Linear's: Settings, inviting
// people, a new team, the theme, sign out and the running version.
export default function WorkspaceMenu({ onNewTeam }: { onNewTeam: () => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: appVersion } = useAppVersionQuery();
  // The session can already be cached when React hydrates while the server
  // rendered without it; reading it after mount keeps the first render identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = mounted ? session?.user : undefined;

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
        <DropdownMenuItem asChild>
          <Link href={settingsHomePath()}>
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={workspaceMembersPath()}>
            <UserPlus />
            Invite people
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewTeam}>
          <Plus />
          New team
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
