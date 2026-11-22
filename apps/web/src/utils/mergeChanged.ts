// Folds the nodes a changed-since query returned into a cached list: a node already
// in the list is replaced in place, a new one is appended, the last copy of a node
// returned twice wins. Returns the same array when nothing changed, so React Query
// keeps the cached reference.
export function mergeChanged<T extends { id: string }>(current: T[], changed: T[]): T[] {
  if (changed.length === 0) return current;
  const latest = new Map<string, T>();
  for (const node of changed) latest.set(node.id, node);
  const merged = current.map((node) => {
    const next = latest.get(node.id);
    if (!next) return node;
    latest.delete(node.id);
    return next;
  });
  return [...merged, ...latest.values()];
}
