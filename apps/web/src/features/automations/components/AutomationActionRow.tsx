import { TriangleAlert, X } from 'lucide-react';
import type { TeamDetail } from '@/types/team';
import { Button } from '@/components/ui/button';
import { useSummaryContext } from '../hooks/useSummaryContext';
import { ACTION_TYPES, actionSummary } from '../utils/ruleForm';
import type { WorkflowAction } from '../utils/rules';
import AutomationActionControl from './AutomationActionControl';

// One action: its kind, its value picker and a remove button. An action that points
// at something removed since (a state, label, member, project or cycle) says so; the
// API refuses to save it until it is changed.
export default function AutomationActionRow({
  action,
  team,
  editable,
  onChange,
  onRemove,
}: {
  action: WorkflowAction;
  team: TeamDetail;
  editable: boolean;
  onChange: (action: WorkflowAction) => void;
  onRemove: () => void;
}) {
  const ctx = useSummaryContext(team, action.type === 'setProject' ? action.projectId : null);
  const summary = actionSummary(action, ctx);
  // A project is looked up by its own query; until it answers it is not known missing.
  const missing = summary.missing && action.type !== 'setProject';
  const label = ACTION_TYPES.find((t) => t.type === action.type)?.label ?? action.type;

  return (
    <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 shrink-0 text-sm text-muted-foreground">{label}</span>
        <div inert={!editable} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <AutomationActionControl action={action} team={team} onChange={onChange} />
        </div>
        {editable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            onClick={onRemove}
            aria-label={`Remove action: ${summary.text}`}
            title="Remove action"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {missing && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5" />
          {summary.text}. Choose another value or remove this action.
        </p>
      )}
    </div>
  );
}
