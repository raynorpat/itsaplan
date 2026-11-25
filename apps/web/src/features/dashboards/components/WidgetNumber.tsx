import { changeText, formatValue } from '../utils/format';

// One figure with its change against the previous period of the same length.
export default function WidgetNumber({
  value,
  previous,
  unit,
}: {
  value: number | null;
  previous: number | null;
  unit: string;
}) {
  const change = changeText(value, previous);
  return (
    <div className="py-2">
      <p className="text-3xl font-semibold tabular-nums">{formatValue(value, unit)}</p>
      {change && <p className="mt-1 text-xs text-muted-foreground">{change}</p>}
    </div>
  );
}
