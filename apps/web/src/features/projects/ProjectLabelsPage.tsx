'use client';

import ProjectLabelsList from './components/labels/ProjectLabelsList';
import ProjectLabelCreateForm from './components/labels/ProjectLabelCreateForm';

// Settings for the workspace-level project labels: list, create, rename, recolor
// and delete. Label groups are managed over the API.
export default function ProjectLabelsPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold">Project labels</h1>
        <p className="text-sm text-muted-foreground">Labels for projects, shared by every team.</p>
      </div>
      <ProjectLabelCreateForm />
      <ProjectLabelsList />
    </div>
  );
}
