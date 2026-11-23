'use client';

import { useUpdateProject, type ProjectDetail } from '@/services/projects.service';
import DraftMarkdownEditor from '@/components/common/editor/DraftMarkdownEditor';

// The project's Markdown description (Linear's Project.content), edited in place and
// saved through projectUpdate when the editor loses focus; unsaved typing survives a
// refresh (DraftMarkdownEditor).
export default function ProjectDescription({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const update = useUpdateProject();
  return (
    <DraftMarkdownEditor
      className="mt-4 text-sm"
      value={project.content}
      editable={canEdit}
      placeholder="Add a description…"
      onSave={(content) => update.mutate({ id: project.id, patch: { content } })}
    />
  );
}
