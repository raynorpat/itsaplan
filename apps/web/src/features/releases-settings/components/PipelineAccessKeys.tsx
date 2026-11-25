import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/utils/dates';
import { useAccessKeyWrites, useAccessKeys } from '../services/releasesSettings.service';
import AccessKeyCreatedDialog from './AccessKeyCreatedDialog';

// A pipeline's CI access keys: who created each and when it was last used. Workspace
// owners and admins create (the key is shown once) and revoke; others read the list.
export default function PipelineAccessKeys({
  pipelineId,
  canManage,
}: {
  pipelineId: string;
  canManage: boolean;
}) {
  const keys = useAccessKeys(pipelineId);
  const { create, revoke } = useAccessKeyWrites(pipelineId);
  const [created, setCreated] = useState<string | null>(null);
  const list = keys.data ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Access keys</h3>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={create.isPending}
            onClick={() => create.mutate(undefined, { onSuccess: setCreated })}
          >
            <Plus className="size-3.5" aria-hidden />
            New key
          </Button>
        )}
      </div>
      {keys.isError && <p className="text-sm text-destructive">{keys.error.message}</p>}
      {list.length === 0 && !keys.isLoading && !keys.isError && (
        <p className="text-sm text-muted-foreground">
          No keys. CI needs a key to sync releases to this pipeline.
        </p>
      )}
      {list.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {list.map((k) => (
            <li key={k.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <KeyRound className="size-3.5 text-muted-foreground" aria-hidden />
              <span>
                Created {formatDate(k.createdAt)}
                {k.creator ? ` by ${k.creator.name}` : ''}
              </span>
              <span className="text-muted-foreground">
                · {k.lastUsedAt ? `last used ${formatDate(k.lastUsedAt)}` : 'never used'}
              </span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(k.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {created && <AccessKeyCreatedDialog accessKey={created} onClose={() => setCreated(null)} />}
    </div>
  );
}
