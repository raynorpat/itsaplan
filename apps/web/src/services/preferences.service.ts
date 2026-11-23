import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest, graphql } from '@/lib/graphql';
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

const ViewerTimezone = graphql(`
  query ViewerTimezone {
    viewer {
      id
      timezone
    }
  }
`);

const TimezoneUpdate = graphql(`
  mutation TimezoneUpdate($id: String!, $input: UserUpdateInput!) {
    userUpdate(id: $id, input: $input) {
      success
    }
  }
`);

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
      timezone:
        (await gqlRequest(ViewerTimezone, {})).viewer.timezone ?? PREFERENCE_DEFAULTS.timezone,
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
      if (timezone !== undefined)
        await gqlRequest(TimezoneUpdate, { id: 'me', input: { timezone } });
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

// The signed-in user's interface preferences. timezone is an IANA zone name the app
// renders stored UTC timestamps in, saved on the account (Linear's User.timezone);
// the rest are kept in this browser (services/preferences.service.ts).
// issueOpenMode decides whether a clicked issue opens in the side panel or on its
// own page; startPage is the section the app root lands on; lastTeamId is the team
// the app root reopens (null until the user has opened one).
export type ThemePreference = 'light' | 'dark' | 'system';

export type IssueOpenMode = 'panel' | 'page';

export type StartPage = 'inbox' | 'work-items' | 'projects';

export type IssueStatsView = 'compact' | 'timeline';

export interface AccountPreferences {
  timezone: string;
  theme: ThemePreference;
  issueOpenMode: IssueOpenMode;
  startPage: StartPage;
  // How the status stats section of an issue starts out: expanded or collapsed, and
  // in the compact bar or the full timeline. Switching it on an issue is not saved —
  // it lasts as long as that issue stays open.
  issueStatsOpen: boolean;
  issueStatsView: IssueStatsView;
  lastTeamId: string | null;
  // The keyboard shortcuts this user rebound, as { commandId: combo }. Only the
  // changed ones; the rest are the built-in bindings (see lib/hotkeys).
  hotkeys: HotkeyOverrides;
}

// Rebound keyboard shortcuts: the combination each overridden command id takes. A
// command left out keeps the binding from the layer below.
export type HotkeyOverrides = Record<string, string>;

export type AccountPreferencesPatch = Partial<AccountPreferences>;
