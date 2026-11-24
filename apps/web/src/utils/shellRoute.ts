export type ShellRoute = {
  teamKey: string | null;
  // The workspace-level areas (inbox, My issues, Projects, Initiatives). Their team
  // comes from ?team= (null when the URL names none; the Shell then falls back to
  // the last team) and the Shell never redirects them to a team.
  workspace: boolean;
  // The segment after the team key: 'view', 'issue', 'cycles', … null on the team
  // root. On a workspace route, the area's name; 'settings' in the Settings area.
  sub: string | null;
  activeViewId: string | null;
  section: string | null;
  // The team-scoped issue number from the URL, not the internal id.
  routeIssueSeq: number | null;
  routeProjectId: string | null;
  // The work items routes, where the layout and selection commands apply.
  onBoard: boolean;
};

// Every path that is not under /team/<key> is a workspace route.
const WORKSPACE_AREAS = ['projects', 'initiatives', 'inbox', 'my-issues', 'settings'];

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
  // (/settings/teams/:key/:section); the account and workspace pages take the
  // Shell's team from ?team= like the other workspace areas.
  if (area === 'settings') {
    const teamSettings = segs[1] === 'teams' && segs[2] != null;
    return {
      teamKey: teamSettings ? (routeTeamKey ?? segs[2]!) : teamParam,
      workspace: !teamSettings,
      sub: 'settings',
      activeViewId: null,
      section: (teamSettings ? segs[3] : segs[2]) ?? null,
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
      sub: area,
      activeViewId: null,
      section: null,
      routeIssueSeq: null,
      routeProjectId: projectId,
      onBoard: false,
    };
  }

  const sub = segs[2] ?? null;
  return {
    teamKey: routeTeamKey,
    workspace: false,
    sub,
    activeViewId: sub === 'view' && segs[3] ? segs[3] : null,
    section: sub === 'settings' ? (segs[3] ?? null) : null,
    routeIssueSeq: sub === 'issue' && segs[3] ? Number(segs[3]) : null,
    routeProjectId: null,
    onBoard: sub == null || sub === 'view',
  };
}
