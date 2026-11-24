import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { triggerSummary, type WorkflowTrigger } from '../utils/rules';

const TRIGGERS: WorkflowTrigger[] = ['entityCreated', 'entityUpdated'];

// When the automation runs: on a new issue, or when an issue starts matching the
// conditions.
export default function AutomationTriggerSelect({
  value,
  onChange,
  disabled,
}: {
  value: WorkflowTrigger;
  onChange: (trigger: WorkflowTrigger) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WorkflowTrigger)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 w-96 max-w-full" aria-label="When">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRIGGERS.map((t) => (
          <SelectItem key={t} value={t}>
            {triggerSummary({ trigger: t })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
