import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { projectsPath } from '@/utils/paths';
import ProjectBreadcrumbName from '@/components/layout/ProjectBreadcrumbName';

// The header title on an project page: Projects › project name.
export default function ProjectBreadcrumb({
  teamKey,
  projectId,
}: {
  teamKey: string | null;
  projectId: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link href={projectsPath()} className="truncate text-muted-foreground hover:text-foreground">
        Projects
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      {teamKey && <ProjectBreadcrumbName projectId={projectId} teamKey={teamKey} />}
    </span>
  );
}
