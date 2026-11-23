// The sortOrder that puts the milestone at `from` at position `to` of a list sorted
// by sortOrder: halfway between its new neighbours, one past an end. `from` equal
// to the list length places a new milestone. Only the moved milestone is written.
export function sortOrderForMove(
  sorted: readonly { sortOrder: number }[],
  from: number,
  to: number,
): number {
  if (from === to && from < sorted.length) return sorted[from]!.sortOrder;
  const rest = sorted.filter((_, i) => i !== from);
  const before = rest[to - 1]?.sortOrder;
  const after = rest[to]?.sortOrder;
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
