import { redirect } from 'next/navigation';
import ProjectsPage from '@/features/projects/ProjectsPage';
import { projectsPath, isProjectsTab } from '@/utils/paths';

// One status tab of the projects list. A segment that names no tab goes back to
// the list ("All" lives at /projects).
export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (tab === 'all' || !isProjectsTab(tab)) redirect(projectsPath());
  return <ProjectsPage tab={tab} />;
}
