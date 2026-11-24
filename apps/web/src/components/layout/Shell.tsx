'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useIssueBySeqQuery } from '@/services/issues.service';
import { useAccountPreferences } from '@/services/preferences.service';
import type { IssueOpenMode } from '@/services/preferences.service';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOverlays } from '@/hooks/useOverlays';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { useShellTeam } from '@/hooks/useShellTeam';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useTeamRouteSync } from '@/hooks/useTeamRouteSync';
import { useRememberAppPath } from '@/hooks/useLastAppPath';
import {
  teamPath,
  issuePath,
  inboxPath,
  myIssuesPath,
  projectsPath,
  settingsHomePath,
} from '@/utils/paths';
import type { GoTarget } from '@/utils/goSequence';
import { shellBodyState } from '@/utils/shellRoute';

// Where each G-then-letter shortcut leads.
const GO_PATHS: Record<GoTarget, () => string> = {
  inbox: inboxPath,
  'my-issues': myIssuesPath,
  projects: () => projectsPath(),
};
import { ShellCtx, type ShellContext } from '@/context/shellContext';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/layout/AppSidebar';
import AppHeader from '@/components/layout/AppHeader';
import { PageHeaderSlotCtx } from '@/context/pageHeaderSlot';
import CommandLayer from '@/components/layout/CommandLayer';
import ShellBody from '@/components/layout/ShellBody';
import ShellHeaderTitle from '@/components/layout/ShellHeaderTitle';
import ShellOverlays from '@/components/layout/ShellOverlays';
import { useTeamsQuery } from '@/services/teams.service';
import { useAccountPreferencesQuery } from '@/services/preferences.service';

// The app's layout for every signed-in page (team pages, the workspace areas and the
// Settings area). It owns the team data, the view editor and the team-level
// overlays, renders the sidebar and header, and passes the team state to the page
// through React context (see context/shellContext).
export default function Shell({
  children,
  defaultSidebarOpen = true,
}: {
  children: ReactNode;
  defaultSidebarOpen?: boolean;
}) {
  const router = useRouter();
  // The page header's slot element, where pages render their header controls.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const route = useShellRoute();
  const { routeIssueSeq } = route;
  // A workspace route takes the team its URL names, else the last team the user had
  // open (else the first): Projects and Initiatives read it, and the new-issue dialog
  // needs one on every page.
  const { data: teamList } = useTeamsQuery();
  const { data: prefs } = useAccountPreferencesQuery();
  const fallbackKey =
    route.workspace && !route.teamKey
      ? ((
          teamList?.find((t) => t.id === prefs?.lastTeamId) ??
          teamList?.find((t) => t.role != null) ??
          teamList?.[0]
        )?.key ?? null)
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
  } = useShellTeam(teamKey, route.activeViewId, route.needsTeam);

  const { issueOpenMode } = useAccountPreferences();
  const overlays = useOverlays();
  const issueQuery = useIssueBySeqQuery(teamKey, routeIssueSeq);

  useTeamRouteSync({ teams, teamsLoaded, teamKey, redirect: !route.workspace });
  useRememberAppPath();
  // The sidebar, switcher and team shortcuts list the teams the user joined; the
  // route guard above accepts every team they can see.
  const joinedTeams = teams.filter((t) => t.role != null);

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
    teams: joinedTeams,
    overlayOpen: overlays.anyOpen,
    onToggleCommand: () => overlays.setShowCommand((v) => !v),
    onSelectTeam: (key) => router.push(teamPath(key)),
    onChangeView: editor.changeView,
    onNewIssue: () => canCreateIssue && openNewIssue(),
    onNewTeam: () => overlays.setShowNewTeam(true),
    onSettings: () => router.push(settingsHomePath()),
    onTeamSettings: () => firstSettingsHref && router.push(firstSettingsHref),
    onGo: (target) => router.push(GO_PATHS[target]()),
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
          // The team the page belongs to: on a workspace route only the one its URL
          // names, not the fallback team the Shell loads for the new-issue dialog.
          currentTeamKey={route.workspace ? route.teamKey : teamKey}
          onNewTeam={() => overlays.setShowNewTeam(true)}
          onOpenCommand={() => overlays.setShowCommand(true)}
          onNewIssue={openNewIssue}
          canCreateIssue={canCreateIssue}
        />
        <SidebarInset className="min-w-0">
          <AppHeader
            slotRef={setHeaderSlot}
            title={
              <ShellHeaderTitle
                route={route}
                teamName={team?.team.name ?? 'Team'}
                issueIdentifier={issueQuery.data?.identifier ?? null}
              />
            }
          />

          {errorMsg && !forbidden && (
            <div className="border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeaderSlotCtx.Provider value={headerSlot}>
              <ShellBody
                state={shellBodyState({
                  forbidden,
                  needsTeam: route.needsTeam,
                  hasTeam: !!team,
                  hasError: !!errorMsg,
                  teamsLoaded,
                  teamCount: joinedTeams.length,
                })}
              >
                {children}
              </ShellBody>
            </PageHeaderSlotCtx.Provider>
          </div>
        </SidebarInset>

        <CommandLayer
          open={overlays.showCommand}
          onOpenChange={overlays.setShowCommand}
          teams={joinedTeams}
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
