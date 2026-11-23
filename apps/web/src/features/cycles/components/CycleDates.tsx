import { formatShortDate } from '@/utils/dates';

// A cycle's first and last day. The API's endsAt is the moment the next cycle
// starts, so the last day is the day before it.
export default function CycleDates({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const lastDay = new Date(new Date(endsAt).getTime() - 1).toISOString();
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {formatShortDate(startsAt)} – {formatShortDate(lastDay)}
    </span>
  );
}
