// The `position` to send with workflowStateUpdate to move a state within its group.
// The API places the state before the first state of its type whose position is
// greater than the value sent, so the value lies between the state's new neighbours in
// the group: one below the first, one above the last, otherwise their midpoint.
export function positionForMove(
  group: { id: string; position: number }[],
  from: number,
  to: number,
): number {
  const next = [...group];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const before = next[to - 1];
  const after = next[to + 1];
  if (!before) return after.position - 1;
  if (!after) return before.position + 1;
  return (before.position + after.position) / 2;
}
