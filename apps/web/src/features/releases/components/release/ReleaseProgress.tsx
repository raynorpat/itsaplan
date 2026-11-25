// A release's completed issues out of all of them, as a bar and a count.
export default function ReleaseProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${completed} of ${total} issues done`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {completed} / {total} done
      </span>
    </div>
  );
}
