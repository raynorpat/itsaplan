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
