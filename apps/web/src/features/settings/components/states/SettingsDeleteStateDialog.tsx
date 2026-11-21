import { useState } from 'react';
import { type TeamDetail, type Column } from '@/lib/api';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDeleteColumn } from '../../services/settings.service';

export default function SettingsDeleteStateDialog({
  team,
  column,
  issueCount,
  onClose,
}: {
  team: TeamDetail;
  column: Column;
  issueCount: number;
  onClose: () => void;
}) {
  const otherColumns = team.states.filter((c) => c.id !== column.id);
  const [action, setAction] = useState<'move' | 'delete'>(otherColumns.length ? 'move' : 'delete');
  const [targetStateId, setTargetColumnId] = useState<string | undefined>(otherColumns[0]?.id);
  const deleteState = useDeleteColumn(team.team.key);

  async function confirm() {
    const body =
      action === 'move' && targetStateId != null
        ? ({ mode: 'move', targetStateId } as const)
        : ({ mode: 'delete' } as const);
    await deleteState.mutateAsync({ id: column.id, body });
    onClose();
  }

  return (
    <ConfirmDialog
      title={`Delete state "${column.name}"`}
      confirmLabel={action === 'move' && issueCount > 0 ? 'Move & delete state' : 'Delete state'}
      confirmDisabled={action === 'move' && issueCount > 0 && targetStateId == null}
      onConfirm={confirm}
      onClose={onClose}
    >
      {issueCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          This state has no issues. It will be removed.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            This state has {issueCount} issue{issueCount === 1 ? '' : 's'}. Choose what happens to
            them.
          </p>
          <div className="space-y-2">
            <Label>
              <Checkbox
                checked={action === 'move'}
                disabled={otherColumns.length === 0}
                onCheckedChange={(v) => v === true && setAction('move')}
              />
              Move issues to another state
            </Label>
            {action === 'move' && (
              <Select
                value={targetStateId != null ? String(targetStateId) : undefined}
                onValueChange={(v) => setTargetColumnId(v)}
              >
                <SelectTrigger className="ml-6 w-[calc(100%-1.5rem)]">
                  <SelectValue placeholder="Select a state" />
                </SelectTrigger>
                <SelectContent>
                  {otherColumns.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} ({c.stateType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Label>
              <Checkbox
                checked={action === 'delete'}
                onCheckedChange={(v) => v === true && setAction('delete')}
              />
              <span className="text-destructive">Delete issues permanently</span>
            </Label>
          </div>
        </div>
      )}
    </ConfirmDialog>
  );
}
