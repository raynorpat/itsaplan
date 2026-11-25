import { Triangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PILL } from './IssueBadges';

// An issue's estimate as a small chip, as Linear shows it on rows and cards, in the same
// pill as the date badges. `label` is the team's way of showing it (a T-shirt size);
// nothing when the issue has no estimate.
export function EstimateBadge({
  estimate,
  label,
}: {
  estimate: number | null | undefined;
  label?: string;
}) {
  if (estimate == null) return null;
  const text = label ?? String(estimate);
  return (
    <Badge
      variant="outline"
      className={cn(PILL, 'shrink-0 gap-1 tabular-nums')}
      title={`Estimate: ${text}`}
    >
      <Triangle aria-hidden className="size-2.5" />
      <span aria-hidden>{text}</span>
      <span className="sr-only">Estimate {text}</span>
    </Badge>
  );
}
