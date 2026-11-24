import { progressPercent } from '../../utils/progressChart';

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Linear's project progress as a small ring and a percentage.
export default function ProgressRing({ progress }: { progress: number }) {
  const percent = progressPercent(progress);
  return (
    <span className="flex items-center gap-1.5">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          className="stroke-primary"
        />
      </svg>
      <span className="text-xs text-muted-foreground tabular-nums">{percent}%</span>
    </span>
  );
}
