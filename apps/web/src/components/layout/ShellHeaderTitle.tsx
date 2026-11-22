import { SETTINGS_SECTIONS } from '@/utils/settingsSections';
import type { ShellRoute } from '@/hooks/useShellRoute';
import ProjectBreadcrumb from '@/components/layout/ProjectBreadcrumb';
import IssueBreadcrumb from '@/components/layout/IssueBreadcrumb';

// The label on the pages that are not an issue or project detail.
function pageLabel(route: ShellRoute, teamName: string): string {
  const { sub, section, aiTeamCrumb } = route;
  if (section) return SETTINGS_SECTIONS.find((s) => s.slug === section)?.label ?? 'Settings';
  if (sub === 'members') return 'Members';
  if (sub === 'projects') return 'Projects';
  if (aiTeamCrumb) return aiTeamCrumb;
  if (sub === 'ai-agents') return 'AI agents';
  if (sub === 'api') return 'API';
  return teamName;
}

// The header title: a breadcrumb on an issue or project page, otherwise the
// page's own label.
export default function ShellHeaderTitle({
  route,
  teamName,
  issueIdentifier,
}: {
  route: ShellRoute;
  teamName: string;
  issueIdentifier: string | null;
}) {
  if (route.routeIssueSeq != null) {
    return (
      <IssueBreadcrumb teamKey={route.teamKey} teamName={teamName} identifier={issueIdentifier} />
    );
  }
  if (route.routeProjectId != null) {
    return <ProjectBreadcrumb teamKey={route.teamKey} projectId={route.routeProjectId} />;
  }
  return <>{pageLabel(route, teamName)}</>;
}
