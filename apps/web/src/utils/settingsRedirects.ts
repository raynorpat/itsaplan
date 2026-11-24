// The addresses the settings pages had before the Settings area, each sent to its
// page under /settings. Read by next.config's redirects(); first match wins.
export const SETTINGS_REDIRECTS: { source: string; destination: string }[] = [
  { source: '/settings', destination: '/settings/account/profile' },
  { source: '/account', destination: '/settings/account/profile' },
  { source: '/account/:slug', destination: '/settings/account/:slug' },
  { source: '/team/:teamKey/notifications', destination: '/settings/account/notifications' },
  { source: '/workspace/settings', destination: '/settings/workspace/general' },
  { source: '/workspace/members', destination: '/settings/workspace/members' },
  { source: '/workspace/applications', destination: '/settings/workspace/applications' },
  { source: '/projects/settings/labels', destination: '/settings/workspace/project-labels' },
  { source: '/team/:teamKey/mcp', destination: '/settings/workspace/mcp' },
  { source: '/team/:teamKey/members', destination: '/settings/teams/:teamKey/members' },
  { source: '/team/:teamKey/settings', destination: '/settings/teams/:teamKey' },
  { source: '/team/:teamKey/settings/:section', destination: '/settings/teams/:teamKey/:section' },
];
