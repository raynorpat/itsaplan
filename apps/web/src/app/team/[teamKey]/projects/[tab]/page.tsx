import { redirect } from 'next/navigation';
import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectsPage from '@/features/projects/ProjectsPage';
import { projectsPath, isProjectsTab } from '@/utils/paths';

// One status tab of the projects list. A segment that names no tab goes back to
// the list ("All" lives at /projects, not /projects/all).
export default async function Page({
  params,
}: {
  params: Promise<{ teamKey: string; tab: string }>;
}) {
  const { teamKey, tab } = await params;
  if (tab === 'all' || !isProjectsTab(tab)) redirect(projectsPath(teamKey));

  return (
    <RequireFeature feature="projects">
      <ProjectsPage tab={tab} />
    </RequireFeature>
  );
}
