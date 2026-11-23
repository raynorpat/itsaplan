import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { useTeamsQuery } from '@/services/teams.service';
import { fetchSubscribedIssueIds, useBoardIssues, useTeamScaffold } from '@/services/board.service';
import { useViewsQuery } from '@/services/views.service';
import { qk } from '@/services/queryKeys';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import {
  applyFilters,
  resolveSubscriberValues,
  subscriberConditions,
  subscriberSetKey,
} from '@/utils/filters';
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
  // viewer) and the issues. They are composed into one team object here so every
  // child reads team.issues.
  const teamQuery = useTeamScaffold(teamKey);
  const boardIssuesQuery = useBoardIssues(teamKey);
  const scaffold = teamQuery.data ?? null;
  const team = useMemo(
    () =>
      scaffold
        ? {
            ...scaffold,
            issues: boardIssuesQuery.data ?? [],
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

  // The subscribers conditions in effect: Linear's Issue carries no subscriber ids,
  // so the server is asked which of the team's issues match each one.
  const viewerId = useSession().data?.user.id ?? '';
  const subscriberKeys = useMemo(
    () => [
      ...new Set(
        subscriberConditions(editor.effectiveFilters).map((c) =>
          subscriberSetKey(c.values, viewerId),
        ),
      ),
    ],
    [editor.effectiveFilters, viewerId],
  );
  const subscriberQueries = useQueries({
    queries: subscriberKeys.map((key) => ({
      queryKey: qk.subscribedIssueIds(teamKey ?? '', key),
      queryFn: () =>
        fetchSubscribedIssueIds(teamKey!, resolveSubscriberValues(key.split(','), viewerId)),
      enabled: teamKey != null && viewerId !== '',
    })),
  });
  const subscriberSets = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    subscriberKeys.forEach((key, i) => {
      const data = subscriberQueries[i]?.data;
      if (data) sets.set(key, data);
    });
    return sets;
    // The query results change identity on every render; their data does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriberKeys, ...subscriberQueries.map((q) => q.data)]);

  // The team with the active filters applied to its issues: the active view's
  // own conditions plus any ad-hoc ones.
  const filteredTeam = useMemo(
    () =>
      team
        ? {
            ...team,
            issues: applyFilters(team.issues, editor.effectiveFilters, team, {
              viewerId,
              subscriberSets,
            }),
          }
        : null,
    [team, editor.effectiveFilters, viewerId, subscriberSets],
  );

  // Anyone who can see the team creates issues in it. Gates the create-issue
  // keyboard shortcut; the header and command palette gate their own controls via
  // usePermissions.
  const canCreateIssue = team?.viewer != null;

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
