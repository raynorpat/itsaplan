import { useState } from 'react';
import type { TeamDetail, Column } from '@/types/team';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRemoveState } from '../../services/settings.service';

// Removes a state the way Linear does: its issues move to another state, then the
// state is archived. The API refuses to archive the last state of a type; its message
// is shown.
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
  const [targetStateId, setTargetStateId] = useState<string | undefined>(otherColumns[0]?.id);
  const removeState = useRemoveState(team.team.key);

  async function confirm() {
    await removeState.mutateAsync({ stateId: column.id, targetStateId: targetStateId ?? null });
    onClose();
  }

  return (
    <ConfirmDialog
      title={`Delete state "${column.name}"`}
      confirmLabel={issueCount > 0 ? 'Move issues & delete state' : 'Delete state'}
      confirmDisabled={issueCount > 0 && targetStateId == null}
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
            This state has {issueCount} issue{issueCount === 1 ? '' : 's'}. Choose the state to move{' '}
            {issueCount === 1 ? 'it' : 'them'} to.
          </p>
          <Select value={targetStateId} onValueChange={setTargetStateId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a state" />
            </SelectTrigger>
            <SelectContent>
              {otherColumns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.stateType})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </ConfirmDialog>
  );
}
