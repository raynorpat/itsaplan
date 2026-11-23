// Folds the nodes a changed-since query returned into a cached list: a node already
// in the list is replaced in place, a new one is appended, the last copy of a node
// returned twice wins. With `getUpdatedAt`, a returned node older than the cached
// one is ignored: a response fetched before the viewer's own edit landed cannot undo
// that edit. Returns the same array when nothing changed, so React Query keeps the
// cached reference.
export function mergeChanged<T extends { id: string }>(
  current: T[],
  changed: T[],
  getUpdatedAt?: (node: T) => string,
): T[] {
  if (changed.length === 0) return current;
  const latest = new Map<string, T>();
  for (const node of changed) latest.set(node.id, node);
  let replaced = false;
  const merged = current.map((node) => {
    const next = latest.get(node.id);
    if (!next) return node;
    latest.delete(node.id);
    if (getUpdatedAt && getUpdatedAt(next) < getUpdatedAt(node)) return node;
    replaced = true;
    return next;
  });
  if (!replaced && latest.size === 0) return current;
  return [...merged, ...latest.values()];
}
