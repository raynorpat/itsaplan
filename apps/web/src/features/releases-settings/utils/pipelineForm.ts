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

// Where a new started stage goes: after the last started stage.
export function newStagePosition(startedPositions: number[]): number {
  return startedPositions.length === 0 ? 1 : Math.max(...startedPositions) + 1;
}
