import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Team } from '@/lib/api';
import { teamPath } from '@/utils/paths';
import {
  useAccountPreferencesQuery,
  useUpdateAccountPreferences,
} from '@/services/preferences.service';

// Keeps the routed team and the account in step: it redirects away from a
// team key that no longer exists, and stores the open team so the index
// route reopens it after the next sign-in, on any device. `teamsLoaded` tells
// an empty list apart from a list that has not arrived yet.
export function useTeamRouteSync({
  teams,
  teamsLoaded,
  teamKey,
}: {
  teams: Team[];
  teamsLoaded: boolean;
  teamKey: string | null;
}) {
  const router = useRouter();
  const prefsQuery = useAccountPreferencesQuery();
  const { mutate: saveLastTeam, isPending: savingPrefs } = useUpdateAccountPreferences();

  // Redirect to a valid team if the routed key does not exist (a stale link or
  // a deleted team), preferring the first.
  useEffect(() => {
    if (!teamsLoaded) return;
    if (teamKey && teams.some((p) => p.key === teamKey)) return;
    const first = teams[0]?.key;
    if (first) router.replace(teamPath(first));
  }, [teamsLoaded, teams, teamKey, router]);

  // Written only when it differs from what is stored. A failed save rolls the
  // cache back, which would satisfy the condition again, so the attempted id is
  // kept and not retried.
  const savedLastTeamId = prefsQuery.data?.lastTeamId ?? null;
  const openTeamId = teams.find((p) => p.key === teamKey)?.id ?? null;
  const failedLastTeamId = useRef<string | null>(null);
  useEffect(() => {
    if (prefsQuery.data == null || openTeamId == null) return;
    if (openTeamId === savedLastTeamId || savingPrefs) return;
    if (openTeamId === failedLastTeamId.current) return;
    saveLastTeam(
      { lastTeamId: openTeamId },
      { onError: () => (failedLastTeamId.current = openTeamId) },
    );
  }, [prefsQuery.data, openTeamId, savedLastTeamId, savingPrefs, saveLastTeam]);
}
