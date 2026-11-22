import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AccountPreferences, type AccountPreferencesPatch } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';

// The signed-in user's interface preferences. Read app-wide (the shell, the app
// root, date formatting), not only on the preferences page, so this service lives
// in the shared layer rather than in the account feature. The time zone is saved on
// the account; every other preference is kept in this browser's localStorage, so it
// applies to this device only.

export const PREFERENCE_DEFAULTS: AccountPreferences = {
  timezone: 'UTC',
  theme: 'system',
  issueOpenMode: 'panel',
  startPage: 'work-items',
  issueStatsOpen: true,
  issueStatsView: 'compact',
  lastTeamId: null,
  hotkeys: {},
};

const STORAGE_KEY = 'itsaplan.preferences';

type LocalPreferences = Omit<AccountPreferences, 'timezone'>;

// The preferences stored in this browser. Empty on the server and when storage is
// unavailable or holds something unreadable.
function readLocal(): Partial<LocalPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Partial<LocalPreferences>) : {};
  } catch {
    return {};
  }
}

function writeLocal(patch: Partial<LocalPreferences>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readLocal(), ...patch }));
  } catch {
    // Storage full or blocked: the change still applies for this session.
  }
}

export function useAccountPreferencesQuery() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: qk.accountPreferences,
    queryFn: async (): Promise<AccountPreferences> => ({
      ...PREFERENCE_DEFAULTS,
      ...readLocal(),
      timezone: (await api.getAccountTimezone()).timezone,
    }),
    // The route needs a session; the login and invite screens have none.
    enabled: Boolean(session),
    // Rarely change and are read on every screen, so keep them out of the refetch path.
    staleTime: 5 * 60_000,
  });
}

// The preferences to render with: the saved ones once loaded, the defaults before.
// Callers never deal with an undefined value.
export function useAccountPreferences(): AccountPreferences {
  return useAccountPreferencesQuery().data ?? PREFERENCE_DEFAULTS;
}

export function useUpdateAccountPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccountPreferencesPatch): Promise<AccountPreferences> => {
      const { timezone, ...local } = input;
      if (Object.keys(local).length > 0) writeLocal(local);
      if (timezone !== undefined) await api.updateAccountTimezone(timezone);
      return {
        ...(qc.getQueryData<AccountPreferences>(qk.accountPreferences) ?? PREFERENCE_DEFAULTS),
        ...input,
      };
    },
    // Merge into the cache before the request completes: a second change made while
    // the first is still in flight is then built on the new value, and the app
    // (theme, timezone) reacts immediately.
    onMutate: (input) => {
      const previous = qc.getQueryData<AccountPreferences>(qk.accountPreferences);
      if (previous) qc.setQueryData(qk.accountPreferences, { ...previous, ...input });
      return { previous };
    },
    onSuccess: (data) => qc.setQueryData(qk.accountPreferences, data),
    onError: (_err, _input, context) => {
      if (context?.previous) qc.setQueryData(qk.accountPreferences, context.previous);
    },
  });
}
