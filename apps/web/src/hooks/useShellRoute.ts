import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { SETTINGS_SECTIONS } from '@/utils/settingsSections';

// The breadcrumb label for an /ai-team/:section route. The chat has no settings
// section entry; the rest take their label from the section config.
function aiTeamLabel(section: string | null): string | null {
  if (!section) return null;
  if (section === 'chat') return 'Chat with AI Team';
  return SETTINGS_SECTIONS.find((s) => s.slug === section)?.label ?? 'AI Team';
}

export type ShellRoute = {
  teamKey: string | null;
  // The workspace-level Projects area (/projects…). Its team comes from ?team=
  // (null when the URL names none; the Shell then falls back to the last team).
  workspace: boolean;
  // The segment after the team key: 'view', 'settings', 'issue', 'members', …
  // null on the team root.
  sub: string | null;
  activeViewId: string | null;
  section: string | null;
  aiTeamCrumb: string | null;
  // The team-scoped issue number from the URL, not the internal id.
  routeIssueSeq: number | null;
  routeProjectId: string | null;
  // The work items routes, where the layout and selection commands apply.
  onBoard: boolean;
};

// The parts of the current route the Shell renders from. The open view, settings
// section and issue live in deeper segments than this layout, so they are read
// from the pathname rather than useParams.
export function useShellRoute(): ShellRoute {
  const params = useParams();
  const pathname = usePathname();
  const search = useSearchParams();

  const segs = pathname.split('/').filter(Boolean); // ['team', key, sub?, id?]
  if (segs[0] === 'projects') {
    const id = segs[1] && segs[1] !== 'tab' && segs[1] !== 'settings' ? segs[1] : null;
    return {
      teamKey: search.get('team'),
      workspace: true,
      sub: 'projects',
      activeViewId: null,
      section: null,
      aiTeamCrumb: null,
      routeIssueSeq: null,
      routeProjectId: id,
      onBoard: false,
    };
  }

  const routeKey = params.teamKey;
  const teamKey = (Array.isArray(routeKey) ? routeKey[0] : routeKey) ?? null;
  const sub = segs[2] ?? null;

  return {
    teamKey,
    workspace: false,
    sub,
    activeViewId: sub === 'view' && segs[3] ? segs[3] : null,
    section: sub === 'settings' ? (segs[3] ?? null) : null,
    aiTeamCrumb: sub === 'ai-team' ? aiTeamLabel(segs[3] ?? null) : null,
    routeIssueSeq: sub === 'issue' && segs[3] ? Number(segs[3]) : null,
    routeProjectId: null,
    onBoard: sub == null || sub === 'view',
  };
}
