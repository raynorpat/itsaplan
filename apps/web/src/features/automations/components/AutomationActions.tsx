import { Plus } from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cyclesVisible } from '@/utils/cycles';
import { ACTION_TYPES, newAction, type ActionType } from '../utils/ruleForm';
import type { WorkflowAction } from '../utils/rules';
import AutomationActionRow from './AutomationActionRow';

// The Then part: the actions in order, each editable or removable, and an "Add action"
// menu. Cycle actions are offered only when the team has cycles, delegation only when
// an agent can be delegated to.
export default function AutomationActions({
  actions,
  team,
  editable,
  onChange,
}: {
  actions: WorkflowAction[];
  team: TeamDetail;
  editable: boolean;
  onChange: (actions: WorkflowAction[]) => void;
}) {
  const offered = ACTION_TYPES.filter(
    ({ type }) =>
      (type !== 'setCycle' || cyclesVisible(team)) &&
      (type !== 'setDelegate' || team.delegates.length > 0),
  );
  const add = (type: ActionType) => onChange([...actions, newAction(type, team.states)]);
  const replace = (i: number, action: WorkflowAction) =>
    onChange(actions.map((a, j) => (j === i ? action : a)));
  const remove = (i: number) => onChange(actions.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      {actions.length === 0 && (
        <p className="text-xs text-muted-foreground">No actions yet. Add at least one.</p>
      )}
      {actions.map((action, i) => (
        <AutomationActionRow
          key={i}
          action={action}
          team={team}
          editable={editable}
          onChange={(next) => replace(i, next)}
          onRemove={() => remove(i)}
        />
      ))}
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="w-fit gap-1.5">
              <Plus className="size-3.5" />
              Add action
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {offered.map(({ type, label }) => (
              <DropdownMenuItem key={type} onSelect={() => add(type)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
