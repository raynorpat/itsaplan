// Sub-issue progress as Linear shows it ("2/5"): a completed or canceled child is
// closed and counts as done.
export function subIssueProgress(children: { state: { type: string } }[]): {
  done: number;
  total: number;
} {
  const done = children.filter(
    (c) => c.state.type === 'completed' || c.state.type === 'canceled',
  ).length;
  return { done, total: children.length };
}

// The create input for an inline "+ Add sub-issue": the trimmed title in the team's
// first state, under the parent. Null when there is nothing to create (an empty
// title, or a team without states).
export function subIssueInput(
  title: string,
  team: { states: { id: string }[] },
  parentId: string,
): { title: string; parentId: string; stateId: string } | null {
  const trimmed = title.trim();
  const stateId = team.states[0]?.id;
  if (!trimmed || !stateId) return null;
  return { title: trimmed, parentId, stateId };
}

// The issues a parent can be picked from: not the issue itself and not one of its
// sub-issues (the API refuses both, and deeper descendants, with a message).
export function parentCandidates<T extends { id: string }>(
  results: T[],
  issueId: string,
  childIds: string[],
): T[] {
  const excluded = new Set([issueId, ...childIds]);
  return results.filter((r) => !excluded.has(r.id));
}

// Sub-issues oldest first, as Linear lists them: a new sub-issue appears at the bottom.
export function sortSubIssues<T extends { createdAt: string }>(children: T[]): T[] {
  return [...children].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
