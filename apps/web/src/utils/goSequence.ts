// Linear's two-key navigation: press G, then a letter within a second.
const GO_TARGETS = {
  i: 'inbox',
  m: 'my-issues',
  p: 'projects',
} as const;

export type GoTarget = (typeof GO_TARGETS)[keyof typeof GO_TARGETS];

const WINDOW_MS = 1000;

// `pending` is the time G was pressed, or null. Returns the next pending state and the
// destination when the sequence completes.
export function goSequenceStep(
  pending: number | null,
  key: string,
  now: number,
): { pending: number | null; target: GoTarget | null } {
  const k = key.toLowerCase();
  if (pending != null && now - pending <= WINDOW_MS) {
    const target = (GO_TARGETS as Record<string, GoTarget>)[k] ?? null;
    return { pending: null, target };
  }
  if (k === 'g') return { pending: now, target: null };
  return { pending: null, target: null };
}
