import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { cn } from '@/lib/utils';
import type { SessionActivity } from '../../utils/agentSession';

// An agent message in the session: a question for the reader (elicitation), the
// result of the turn (response), or an error, as rendered Markdown.
const LABEL: Partial<Record<SessionActivity['type'], string>> = {
  elicitation: 'Asks',
  error: 'Error',
};

export default function AgentActivityMessage({ activity }: { activity: SessionActivity }) {
  const label = LABEL[activity.type];
  return (
    <li
      className={cn(
        'rounded-md bg-muted/50 px-3 py-2 text-sm',
        activity.type === 'error' && 'text-destructive',
      )}
    >
      {label && <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>}
      <MarkdownEditor
        key={activity.id}
        className="text-sm"
        defaultValue={activity.body ?? ''}
        editable={false}
      />
    </li>
  );
}
