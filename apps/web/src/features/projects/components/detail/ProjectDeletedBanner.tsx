'use client';

import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/types/project';
import { usePermissions } from '@/hooks/usePermissions';
import { useRestoreProject } from '@/services/projects.service';
import { Button } from '@/components/ui/button';
import { projectBannerText } from '../../utils/projectList';

// Shown on a trashed or archived project's page, with Restore for those who may edit
// the project.
export default function ProjectDeletedBanner({
  project,
  teamKey,
}: {
  project: Pick<Project, 'id' | 'archivedAt' | 'trashed'>;
  teamKey: string;
}) {
  const { can } = usePermissions();
  const restore = useRestoreProject(teamKey);
  const text = projectBannerText(project);
  if (!text) return null;

  const onRestore = () =>
    restore.mutate(project.id, {
      onSuccess: () => toast.success('Project restored.'),
      onError: (err) => toast.error(err.message || 'Could not restore the project.'),
    });

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground"
    >
      <Trash2 className="size-4 shrink-0" />
      <span className="flex-1">{text}</span>
      {can('projects', 'edit') && (
        <Button size="sm" variant="outline" disabled={restore.isPending} onClick={onRestore}>
          Restore
        </Button>
      )}
    </div>
  );
}
