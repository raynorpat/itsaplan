// Sparse positions (sortOrder, position): a moved or new item gets a value between its
// new neighbours, so only that item is written.

const STEP = 1000;

// The position between two neighbours (either may be missing): their midpoint, one
// step below the first or above the last, or one step in an empty list.
export function positionBetween(before?: number, after?: number, step = STEP): number {
  if (before === undefined && after === undefined) return step;
  if (before === undefined) return after! - step;
  if (after === undefined) return before + step;
  return (before + after) / 2;
}

// The position for the item at `from` moved to index `to` of a list ordered by
// `positions`. A move onto itself keeps its position; `from` equal to the list length
// places a new item.
export function positionForMove(
  positions: readonly number[],
  from: number,
  to: number,
  step = STEP,
): number {
  if (from === to && from < positions.length) return positions[from]!;
  const rest = positions.filter((_, i) => i !== from);
  return positionBetween(rest[to - 1], rest[to], step);
}
