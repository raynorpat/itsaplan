import type { ReleaseStage } from '@/services/releases.service';

// A release stage as a coloured dot and its name.
export default function ReleaseStageBadge({ stage }: { stage: ReleaseStage }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
      {stage.name}
    </span>
  );
}
