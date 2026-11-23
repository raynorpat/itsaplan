'use client';

import { useUpdateProject, type ProjectDetail } from '@/services/projects.service';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';

// The project's Markdown description (Linear's Project.content), edited in place and
// saved through projectUpdate when the editor loses focus.
export default function ProjectDescription({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const update = useUpdateProject();
  return (
    <MarkdownEditor
      key={`content-${project.updatedAt}`}
      className="mt-4 text-sm"
      defaultValue={project.content}
      editable={canEdit}
      placeholder="Add a description…"
      onBlur={(content) => {
        if (content !== project.content) update.mutate({ id: project.id, patch: { content } });
      }}
    />
  );
}
