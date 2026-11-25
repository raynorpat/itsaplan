// Helpers for team settings → Releases.

// Path patterns typed one per line (or comma-separated), trimmed, without blanks or
// repeats.
export function parsePathPatterns(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n,]/)) {
    const pattern = part.trim();
    if (pattern) seen.add(pattern);
  }
  return [...seen];
}

// The position for the item at `from` moved to index `to` in a list ordered by
// `positions`: halfway between its new neighbours, or one past the end it moves to.
export function movedPosition(positions: number[], from: number, to: number): number {
  if (from === to) return positions[from]!;
  const rest = positions.filter((_, i) => i !== from);
  const before = rest[to - 1];
  const after = rest[to];
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

// Where a new started stage goes: after the last started stage.
export function newStagePosition(startedPositions: number[]): number {
  return startedPositions.length === 0 ? 1 : Math.max(...startedPositions) + 1;
}
