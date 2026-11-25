// Positions of customer statuses and tiers: sparse floats, as the API orders them.

const STEP = 1000;

// The position for an item placed between two neighbours (either may be missing).
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return STEP;
  if (before === undefined) return after! - STEP;
  if (after === undefined) return before + STEP;
  return (before + after) / 2;
}

// The position for the item at `from` dropped at index `to` of the same list.
export function positionForMove(
  list: { id: string; position: number }[],
  from: number,
  to: number,
): number {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return positionBetween(next[to - 1]?.position, next[to + 1]?.position);
}
