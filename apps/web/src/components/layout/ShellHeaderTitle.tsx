import type { ShellRoute } from '@/hooks/useShellRoute';
import ProjectBreadcrumb from '@/components/layout/ProjectBreadcrumb';
import IssueBreadcrumb from '@/components/layout/IssueBreadcrumb';

// The label on the pages that are not an issue or project detail.
function pageLabel(route: ShellRoute, teamName: string): string {
  const { sub } = route;
  if (sub === 'settings') return 'Settings';
  if (sub === 'projects') return 'Projects';
  if (sub === 'initiatives') return 'Initiatives';
  if (sub === 'feedback') return 'Feedback';
  if (sub === 'dashboards') return 'Dashboards';
  if (sub === 'inbox') return 'Inbox';
  if (sub === 'my-issues') return 'My issues';
  if (sub === 'cycles') return 'Cycles';
  if (sub === 'releases') return 'Releases';
  if (sub === 'views') return route.workspace ? 'Views' : `${teamName} › Views`;
  return teamName;
}

// The header title: a breadcrumb on an issue or project page, otherwise the
// page's own label.
export default function ShellHeaderTitle({
  route,
  teamName,
  issueId,
  issueIdentifier,
}: {
  route: ShellRoute;
  teamName: string;
  issueId: string | null;
  issueIdentifier: string | null;
}) {
  if (route.routeIssueSeq != null) {
    return (
      <IssueBreadcrumb
        teamKey={route.teamKey}
        teamName={teamName}
        issueId={issueId}
        identifier={issueIdentifier}
      />
    );
  }
  if (route.routeProjectId != null) {
    return <ProjectBreadcrumb teamKey={route.teamKey} projectId={route.routeProjectId} />;
  }
  return <>{pageLabel(route, teamName)}</>;
}
