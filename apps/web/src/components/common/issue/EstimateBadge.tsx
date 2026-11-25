import { Triangle } from 'lucide-react';

// An issue's estimate as a small chip, as Linear shows it on rows and cards. Nothing
// when the issue has no estimate, so teams that do not estimate never see it.
export function EstimateBadge({ estimate }: { estimate: number | null | undefined }) {
  if (estimate == null) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums"
      title={`Estimate: ${estimate}`}
    >
      <Triangle aria-hidden className="size-2.5" />
      <span aria-hidden>{estimate}</span>
      <span className="sr-only">Estimate {estimate}</span>
    </span>
  );
}
