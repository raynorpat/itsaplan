import RequireFeature from '@/components/common/permissions/RequireFeature';
import ProjectDetailPage from '@/features/projects/ProjectDetailPage';

export default function Page() {
  return (
    <RequireFeature feature="projects">
      <ProjectDetailPage tab="overview" />
    </RequireFeature>
  );
}
