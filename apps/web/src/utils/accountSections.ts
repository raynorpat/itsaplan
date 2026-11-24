import {
  AppWindow,
  KeyRound,
  Link2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

// The account pages every signed-in user reaches, so there is no permission gate.
// Each slug is a page under /settings/account/<slug>. Used by the Settings sidebar
// and the command palette's section search.
export type AccountSection = { slug: string; label: string; icon: LucideIcon };

export const ACCOUNT_SECTIONS: AccountSection[] = [
  { slug: 'profile', label: 'Profile', icon: UserRound },
  { slug: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { slug: 'accounts', label: 'Accounts', icon: Link2 },
  { slug: 'security', label: 'Security', icon: ShieldCheck },
  { slug: 'api-keys', label: 'API keys', icon: KeyRound },
  { slug: 'authorized-apps', label: 'Authorized apps', icon: AppWindow },
];

export const accountPath = (slug: string) => `/settings/account/${slug}`;
