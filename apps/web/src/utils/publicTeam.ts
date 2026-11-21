import type { Issue, Permissions, TeamDetail, PublicScaffold } from '@/lib/api';

// Assembles a TeamDetail from a public share bundle so the read-only pages can
// reuse the same components as the authenticated app (the board layouts, the issue
// Properties grid). The public scaffold carries no viewer/permissions (a public
// page has no session) and its assignees carry no email; this fills the shape with
// an empty permission matrix (every can() check resolves false) and a placeholder
// email.
export function toPublicTeamDetail(scaffold: PublicScaffold, issues: Issue[] = []): TeamDetail {
  return {
    team: scaffold.team,
    states: scaffold.states,
    issueTypes: scaffold.issueTypes,
    labels: scaffold.labels,
    labelGroups: scaffold.labelGroups,
    assignees: scaffold.assignees.map((a) => ({ ...a, email: '' })),
    customFields: scaffold.customFields,
    viewer: { role: 'member' },
    permissions: {} as Permissions,
    issues,
    rev: '',
  };
}
