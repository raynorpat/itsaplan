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
// state is archived. When some issues cannot move, the dialog stays open and lists
// them; confirming again retries the ones still in the state.
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
  const [failed, setFailed] = useState<{ identifier: string; message: string }[]>([]);
  const removeState = useRemoveState(team.team.key);

  async function confirm() {
    const result = await removeState.mutateAsync({
      stateId: column.id,
      targetStateId: targetStateId ?? null,
      states: team.states,
    });
    if (result.failed.length > 0) {
      setFailed(result.failed);
      // Throwing keeps the dialog open and re-enables its buttons for a retry.
      throw new Error('Some issues could not be moved');
    }
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
      {failed.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-destructive">
            The state was kept. {failed.length} issue{failed.length === 1 ? '' : 's'} could not be
            moved:
          </p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {failed.map((f) => (
              <li key={f.identifier}>
                {f.identifier}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConfirmDialog>
  );
}
