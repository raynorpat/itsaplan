import { Triangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PILL } from './IssueBadges';

// An issue's estimate as a small chip, as Linear shows it on rows and cards, in the same
// pill as the date badges. Nothing when the issue has no estimate, so teams that do not
// estimate never see it.
export function EstimateBadge({ estimate }: { estimate: number | null | undefined }) {
  if (estimate == null) return null;
  return (
    <Badge
      variant="outline"
      className={cn(PILL, 'shrink-0 gap-1 tabular-nums')}
      title={`Estimate: ${estimate}`}
    >
      <Triangle aria-hidden className="size-2.5" />
      <span aria-hidden>{estimate}</span>
      <span className="sr-only">Estimate {estimate}</span>
    </Badge>
  );
}
