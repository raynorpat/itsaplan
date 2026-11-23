import type { ChartPoint } from '../utils/cyclePage';

const WIDTH = 320;
const HEIGHT = 96;
const PAD = 4;

type Series = { key: 'scope' | 'started' | 'completed'; label: string; className: string };

const SERIES: Series[] = [
  { key: 'scope', label: 'Scope', className: 'stroke-muted-foreground' },
  { key: 'started', label: 'Started', className: 'stroke-amber-500' },
  { key: 'completed', label: 'Completed', className: 'stroke-primary' },
];

// The cycle's scope, started and completed per recorded day, across all of the
// cycle's days.
export default function CycleChart({ points, days }: { points: ChartPoint[]; days: number }) {
  if (points.length === 0)
    return <p className="text-xs text-muted-foreground">No progress recorded yet.</p>;

  const max = Math.max(1, ...points.map((p) => p.scope));
  const x = (i: number) => PAD + (i / Math.max(1, days - 1)) * (WIDTH - 2 * PAD);
  const y = (v: number) => HEIGHT - PAD - (v / max) * (HEIGHT - 2 * PAD);
  const line = (key: Series['key']) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join(' ');

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-24 w-full max-w-sm"
        role="img"
        aria-label="Cycle progress over time"
      >
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={HEIGHT - PAD}
          y2={HEIGHT - PAD}
          className="stroke-border"
        />
        {SERIES.map((s) => (
          <path key={s.key} d={line(s.key)} fill="none" strokeWidth={2} className={s.className} />
        ))}
      </svg>
      <figcaption className="flex gap-4 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width="10" height="2" aria-hidden>
              <line x1="0" x2="10" y1="1" y2="1" strokeWidth={2} className={s.className} />
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
