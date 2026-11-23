import { Badge } from '@/components/ui/badge';
import { sessionStatus, type AgentSessionStatus } from '../../utils/agentSession';

// The session's status as a small chip. Only an error uses the destructive color
// (DESIGN.md); a session waiting for the reader stands out with the selected fill.
export default function AgentSessionStatusChip({ status }: { status: AgentSessionStatus }) {
  const { label, tone } = sessionStatus(status);
  const variant = tone === 'error' ? 'destructive' : tone === 'waiting' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className="px-1.5 py-0 text-[11px] leading-4 font-normal">
      {label}
    </Badge>
  );
}
