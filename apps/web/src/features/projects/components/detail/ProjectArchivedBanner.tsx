'use client';

import { Archive } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useSetProjectArchived } from '@/services/projects.service';
import { Button } from '@/components/ui/button';

// Shown on an archived project's page, with Unarchive for those who may edit it.
export default function ProjectArchivedBanner({
  projectId,
  teamKey,
}: {
  projectId: string;
  teamKey: string;
}) {
  const { can } = usePermissions();
  const setArchived = useSetProjectArchived(teamKey);

  const unarchive = () =>
    setArchived.mutate(
      { id: projectId, archived: false },
      {
        onSuccess: () => toast.success('Project unarchived.'),
        onError: (err) => toast.error(err.message || 'Could not unarchive the project.'),
      },
    );

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm text-muted-foreground"
    >
      <Archive className="size-4 shrink-0" />
      <span className="flex-1">This project is archived.</span>
      {can('projects', 'edit') && (
        <Button size="sm" variant="outline" disabled={setArchived.isPending} onClick={unarchive}>
          Unarchive
        </Button>
      )}
    </div>
  );
}
