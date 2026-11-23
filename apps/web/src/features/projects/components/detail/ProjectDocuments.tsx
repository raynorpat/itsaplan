'use client';

import type { TeamDetail } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import type { ProjectDetail } from '@/services/projects.service';
import DocumentList from '@/components/common/documents/DocumentList';

// The Documents tab: the project's documents, each opened in the document sheet.
// Creating, editing and deleting need the right to edit projects.
export default function ProjectDocuments({
  project,
  team,
}: {
  project: ProjectDetail;
  team: TeamDetail;
}) {
  const canEdit = usePermissions().can('projects', 'edit');
  const imageByUserId = new Map(team.assignees.map((a) => [a.userId, a.image]));

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <DocumentList
        parent={{ projectId: project.id }}
        heading={false}
        canEdit={canEdit}
        assignees={team.assignees}
        imageByUserId={imageByUserId}
      />
    </div>
  );
}
