export type ShellRoute = {
  teamKey: string | null;
  // The workspace-level areas (inbox, My issues, Projects, Initiatives, the account
  // and workspace settings). Their team comes from ?team= (null when the URL names
  // none) and the Shell never redirects them to a team.
  workspace: boolean;
  // Whether the page reads a team from the Shell. The inbox, My issues and the
  // account and workspace settings do not: they render without one and load no
  // team's board. Projects and Initiatives still take a team (the URL's, else the
  // last one open).
  needsTeam: boolean;
  // The segment after the team key: 'view', 'issue', 'cycles', … null on the team
  // root. On a workspace route, the area's name; 'settings' in the Settings area.
  sub: string | null;
  activeViewId: string | null;
  // The team-scoped issue number from the URL, not the internal id.
  routeIssueSeq: number | null;
  routeProjectId: string | null;
  // The issues routes, where the layout and selection commands apply.
  onBoard: boolean;
};

// Every path that is not under /team/<key> or /settings is one of these areas. The
// workspace Views page reads no team (needsTeam false).
const WORKSPACE_AREAS = [
  'projects',
  'initiatives',
  'inbox',
  'my-issues',
  'views',
  'feedback',
  'dashboards',
];
// The workspace areas whose pages read the Shell's team.
const TEAM_AREAS = ['projects', 'initiatives'];

// The parts of a route the Shell renders from. `teamParam` is ?team=, `routeTeamKey`
// the [teamKey] route param.
export function parseShellRoute(
  pathname: string,
  teamParam: string | null,
  routeTeamKey: string | null,
): ShellRoute {
  const segs = pathname.split('/').filter(Boolean); // ['team', key, sub?, id?]
  const area = segs[0] ?? '';
  // The Settings area: a team's settings name their team in the path
  // (/settings/teams/:key/:section); the account and workspace pages need no team.
  if (area === 'settings') {
    const teamSettings = segs[1] === 'teams' && segs[2] != null;
    return {
      teamKey: teamSettings ? (routeTeamKey ?? segs[2]!) : teamParam,
      workspace: !teamSettings,
      needsTeam: teamSettings,
      sub: 'settings',
      activeViewId: null,
      routeIssueSeq: null,
      routeProjectId: null,
      onBoard: false,
    };
  }
  if (WORKSPACE_AREAS.includes(area)) {
    const projectId =
      area === 'projects' && segs[1] && segs[1] !== 'tab' && segs[1] !== 'settings'
        ? segs[1]
        : null;
    return {
      teamKey: teamParam,
      workspace: true,
      needsTeam: TEAM_AREAS.includes(area),
      sub: area,
      activeViewId: null,
      routeIssueSeq: null,
      routeProjectId: projectId,
      onBoard: false,
    };
  }

  const sub = segs[2] ?? null;
  return {
    teamKey: routeTeamKey,
    workspace: false,
    needsTeam: true,
    sub,
    activeViewId: sub === 'view' && segs[3] ? segs[3] : null,
    routeIssueSeq: sub === 'issue' && segs[3] ? Number(segs[3]) : null,
    routeProjectId: null,
    onBoard: sub == null || sub === 'view',
  };
}

export type ShellBodyState = 'page' | 'forbidden' | 'unavailable' | 'no-teams' | 'loading';

// What the Shell's content area shows. A page that needs no team renders at once;
// one that does waits for its team, and stands in with a message while it loads,
// when the account has no teams, or when the team is not readable by the viewer.
export function shellBodyState(s: {
  forbidden: boolean;
  needsTeam: boolean;
  hasTeam: boolean;
  hasError: boolean;
  teamsLoaded: boolean;
  teamCount: number;
}): ShellBodyState {
  if (!s.needsTeam) return 'page';
  if (s.forbidden) return 'forbidden';
  if (s.hasTeam) return 'page';
  if (s.hasError) return 'unavailable';
  return s.teamsLoaded && s.teamCount === 0 ? 'no-teams' : 'loading';
}
