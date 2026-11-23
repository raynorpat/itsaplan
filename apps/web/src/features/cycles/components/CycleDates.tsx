import { formatShortDate } from '@/utils/dates';
import { cycleDays } from '../utils/cyclePage';

// A cycle's first and last day. Cycles run on UTC days, so the dates are shown as
// those calendar days, not shifted into the viewer's zone.
export default function CycleDates({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const { first, last } = cycleDays(startsAt, endsAt);
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {formatShortDate(first)} – {formatShortDate(last)}
    </span>
  );
}
