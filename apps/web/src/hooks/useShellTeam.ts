import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useBoardIssuesQuery, useTeamQuery, useTeamsQuery } from '@/services/teams.service';
import { useViewsQuery } from '@/services/views.service';
import { ApiError } from '@/lib/api';
import { applyFilters } from '@/utils/filters';
import { viewPath } from '@/utils/paths';
import { useViewEditor } from '@/hooks/useViewEditor';

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

// The team state behind the Shell: the team list, the composed team, the
// saved views and the view editor, plus the load/error flags the Shell renders
// from. Kept out of the Shell so it stays a composition of chrome and overlays.
export function useShellTeam(teamKey: string | null, activeViewId: string | null) {
  const router = useRouter();

  const teamsQuery = useTeamsQuery();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  // The board loads as two queries: the scaffold (columns/types/labels/fields/
  // viewer) and the issues + change marker. They are composed into one team
  // object here so every child reads team.issues / team.rev as before.
  const teamQuery = useTeamQuery(teamKey);
  const boardIssuesQuery = useBoardIssuesQuery(teamKey);
  const scaffold = teamQuery.data ?? null;
  const team = useMemo(
    () =>
      scaffold
        ? {
            ...scaffold,
            issues: boardIssuesQuery.data?.issues ?? [],
            rev: boardIssuesQuery.data?.rev ?? '',
          }
        : null,
    [scaffold, boardIssuesQuery.data],
  );

  const viewsQuery = useViewsQuery(teamKey);
  const views = useMemo(() => viewsQuery.data ?? [], [viewsQuery.data]);

  // Saved-views, layout, display and filter editing for the current team. The
  // active view is the route param; selecting a view navigates.
  const editor = useViewEditor(
    teamKey,
    views,
    activeViewId,
    (id) => teamKey && router.push(viewPath(teamKey, id)),
  );

  // The team with the active filters applied to its issues: the active view's
  // own conditions plus any ad-hoc ones.
  const filteredTeam = useMemo(
    () =>
      team ? { ...team, issues: applyFilters(team.issues, editor.effectiveFilters, team) } : null,
    [team, editor.effectiveFilters],
  );

  // The Shell provides the permission context, so the viewer is read directly
  // rather than through usePermissions. Gates the create-issue keyboard shortcut;
  // the header and command palette gate their own controls via usePermissions.
  const viewer = team?.viewer ?? null;
  const canCreateIssue =
    !!viewer && (viewer.role === 'owner' || team?.permissions.work_items?.create === true);

  const error = teamsQuery.error ?? teamQuery.error ?? boardIssuesQuery.error ?? viewsQuery.error;

  return {
    teams,
    teamsLoaded: teamsQuery.data != null,
    team,
    filteredTeam,
    views,
    editor,
    canCreateIssue,
    errorMsg: errorMessage(error),
    // A 403 means the session is valid but the user is not a member of this
    // team. Shown as an access message instead of the generic error banner
    // (and never as a login bounce — the middleware owns the no-session case).
    forbidden: error instanceof ApiError && error.status === 403,
  };
}
