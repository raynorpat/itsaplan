import { formatDistanceToNow, parseISO } from 'date-fns';
import type { WorkflowRule } from '../utils/rules';

// A rule's run count, when it last ran, and its last error (an action that no longer
// fit, recorded by the API when the rule ran).
export default function AutomationStats({ rule }: { rule: WorkflowRule }) {
  const runs = rule.stats.runs;
  return (
    <div className="mt-0.5 text-xs text-muted-foreground">
      {runs === 0 ? 'Never ran' : `${runs} ${runs === 1 ? 'run' : 'runs'}`}
      {rule.lastExecutedAt &&
        ` · last ${formatDistanceToNow(parseISO(rule.lastExecutedAt), { addSuffix: true })}`}
      {rule.stats.lastError && (
        <span className="mt-0.5 block text-destructive">{rule.stats.lastError}</span>
      )}
    </div>
  );
}
