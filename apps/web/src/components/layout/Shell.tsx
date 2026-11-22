'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useIssueBySeqQuery } from '@/services/issues.service';
import { useAccountPreferences } from '@/services/preferences.service';
import type { IssueOpenMode } from '@/lib/api';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOverlays } from '@/hooks/useOverlays';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { useShellTeam } from '@/hooks/useShellTeam';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useTeamRouteSync } from '@/hooks/useTeamRouteSync';
import { teamPath, issuePath } from '@/utils/paths';
import { ShellCtx, type ShellContext } from '@/context/shellContext';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/layout/AppSidebar';
import AppHeader from '@/components/layout/AppHeader';
import CommandLayer from '@/components/layout/CommandLayer';
import ShellBody from '@/components/layout/ShellBody';
import ShellHeaderTitle from '@/components/layout/ShellHeaderTitle';
import ShellOverlays from '@/components/layout/ShellOverlays';
import { useTeamsQuery } from '@/services/teams.service';
import { useAccountPreferencesQuery } from '@/services/preferences.service';

// The layout for /team/:teamKey and its children (the work items view and the
// settings pages). It owns the team data, the view editor and the
// team-level overlays, renders the sidebar + header chrome, and passes the
// team state to the active child through React context (see lib/shellContext).
export default function Shell({
  children,
  defaultSidebarOpen = true,
}: {
  children: ReactNode;
  defaultSidebarOpen?: boolean;
}) {
  const router = useRouter();
  const route = useShellRoute();
  const { routeIssueSeq } = route;
  // The Projects area is above the teams; it shows the team its URL names, or the
  // last team the user had open (else the first), so the sidebar stays populated.
  const { data: teamList } = useTeamsQuery();
  const { data: prefs } = useAccountPreferencesQuery();
  const fallbackKey =
    route.workspace && !route.teamKey
      ? ((teamList?.find((t) => t.id === prefs?.lastTeamId) ?? teamList?.[0])?.key ?? null)
      : null;
  const teamKey = route.teamKey ?? fallbackKey;

  const {
    teams,
    teamsLoaded,
    team,
    filteredTeam,
    views,
    editor,
    canCreateIssue,
    errorMsg,
    forbidden,
  } = useShellTeam(teamKey, route.activeViewId);

  const { issueOpenMode, showChatByDefault } = useAccountPreferences();
  const overlays = useOverlays(showChatByDefault);
  const issueQuery = useIssueBySeqQuery(teamKey, routeIssueSeq);

  useTeamRouteSync({ teams, teamsLoaded, teamKey, redirect: !route.workspace });

  // The settings sections the member may open; the hotkey lands on the first of
  // them, the same entry the sidebar links to.
  const { firstHref: firstSettingsHref } = useSettingsNavGroups(teamKey, team);

  const openNewIssue = () =>
    team && overlays.setNewIssueDefaults({ stateId: team.states[0]?.id ?? '' });

  // The issue the palette builds its issue commands for: the open detail panel
  // takes precedence over the issue page behind it.
  const currentIssueId = overlays.openIssueId ?? issueQuery.data?.id ?? null;
  // After deleting or archiving from the palette: close the panel, or leave the
  // issue page it was run from.
  const onIssueDeleted = () => {
    if (overlays.openIssueId != null) overlays.setOpenIssueId(null);
    else if (teamKey && routeIssueSeq != null) router.push(teamPath(teamKey));
  };

  useKeyboardShortcuts({
    hasTeam: !!team,
    teams,
    overlayOpen: overlays.anyOpen,
    onToggleCommand: () => overlays.setShowCommand((v) => !v),
    onSelectTeam: (key) => router.push(teamPath(key)),
    onChangeView: editor.changeView,
    onNewIssue: () => canCreateIssue && openNewIssue(),
    onNewTeam: () => overlays.setShowNewTeam(true),
    onSettings: () => firstSettingsHref && router.push(firstSettingsHref),
  });

  // Every view opens an issue through this one callback, so the user's choice
  // between the side panel and a full page is applied here rather than at each call
  // site. `mode` overrides that choice for a call site that means one of them (the
  // context menu's Preview / Go to issue). The views pass the internal issue id
  // while the URL addresses an issue by its team-scoped number, so the page route
  // resolves the number first and falls back to the panel when the issue is not on
  // the loaded board.
  const openIssue = (id: string, mode: IssueOpenMode = issueOpenMode) => {
    if (mode === 'page' && teamKey) {
      const seq = team?.issues.find((i) => i.id === id)?.sequenceNumber;
      if (seq != null) {
        router.push(issuePath(teamKey, seq));
        return;
      }
    }
    overlays.setOpenIssueId(id);
  };

  const context: ShellContext = {
    team,
    filteredTeam,
    views,
    editor,
    onOpenIssue: openIssue,
    onAddIssue: overlays.setNewIssueDefaults,
  };

  return (
    <ShellCtx.Provider value={context}>
      <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-svh overflow-hidden">
        <AppSidebar
          teams={teams}
          currentTeamKey={teamKey}
          onSelectTeam={(key) => router.push(teamPath(key))}
          onNewTeam={() => overlays.setShowNewTeam(true)}
        />
        <SidebarInset className="min-w-0">
          <AppHeader
            title={
              <ShellHeaderTitle
                route={route}
                teamName={team?.team.name ?? 'Team'}
                issueIdentifier={issueQuery.data?.identifier ?? null}
              />
            }
            hasTeam={!!team}
            onOpenCommand={() => overlays.setShowCommand(true)}
            onNewIssue={openNewIssue}
            chatActive={overlays.chatEnabled}
            onToggleChat={overlays.toggleChat}
          />

          {errorMsg && !forbidden && (
            <div className="border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ShellBody
              forbidden={forbidden}
              hasTeam={!!team}
              hasError={!!errorMsg}
              teamsLoaded={teamsLoaded}
              teamCount={teams.length}
            >
              {children}
            </ShellBody>
          </div>
        </SidebarInset>

        <CommandLayer
          open={overlays.showCommand}
          onOpenChange={overlays.setShowCommand}
          teams={teams}
          currentTeamKey={teamKey}
          onBoard={route.onBoard}
          view={editor.view}
          currentIssueId={currentIssueId}
          onViewChange={editor.changeView}
          onNewIssue={openNewIssue}
          // Handled by the kanban board's selection provider (mounted only on the
          // board); the constant matches BOARD_SELECT_ALL_EVENT in useSelection.
          onSelectAll={() => window.dispatchEvent(new Event('board:select-all'))}
          onNewTeam={() => overlays.setShowNewTeam(true)}
          onSelectTeam={(key) => router.push(teamPath(key))}
          onOpenIssue={(seq) => teamKey && router.push(issuePath(teamKey, seq))}
          onIssueDeleted={onIssueDeleted}
        />

        <ShellOverlays team={team} teamKey={teamKey} overlays={overlays} />
      </SidebarProvider>
    </ShellCtx.Provider>
  );
}
