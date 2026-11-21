import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectsPage from '@/features/projects/ProjectsPage';

export default function Page() {
  return (
    <RequireFeature feature="projects">
      <ProjectsPage tab="all" />
    </RequireFeature>
  );
}
