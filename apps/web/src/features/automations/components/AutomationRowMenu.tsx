'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  useArchiveAutomation,
  useDeleteAutomation,
  useUnarchiveAutomation,
} from '../services/automations.service';
import type { WorkflowRule } from '../utils/rules';

// A rule's options: Archive (or Unarchive for an archived rule) and Delete.
export default function AutomationRowMenu({ rule }: { rule: WorkflowRule }) {
  const [confirming, setConfirming] = useState(false);
  const archive = useArchiveAutomation(rule.teamId);
  const unarchive = useUnarchiveAutomation(rule.teamId);
  const remove = useDeleteAutomation(rule.teamId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for ${rule.name}`}
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {rule.archivedAt ? (
            <DropdownMenuItem onSelect={() => unarchive.mutate(rule.id)}>
              <ArchiveRestore className="size-4" />
              Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => archive.mutate(rule.id)}>
              <Archive className="size-4" />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmDialog
          title="Delete automation"
          confirmLabel="Delete"
          onConfirm={() => remove.mutateAsync(rule.id).then(() => undefined)}
          onClose={() => setConfirming(false)}
        >
          <div className="text-sm text-muted-foreground">
            Delete <strong>{rule.name}</strong>? The changes it already made stay on the issues.
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
