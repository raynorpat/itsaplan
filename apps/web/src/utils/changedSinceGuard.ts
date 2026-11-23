// Per list (by its query key text): a generation number that a full reload bumps,
// and when the list was last reloaded in full. A changed-since response is applied
// only if no full reload happened while it was in flight; otherwise it could put back
// an item the reload had just dropped. One record per list, shared by every hook
// instance that observes it.
export function createChangedSinceGuard() {
  const generation = new Map<string, number>();
  const reloadedAt = new Map<string, number>();
  return {
    begin: (key: string) => generation.get(key) ?? 0,
    isCurrent: (key: string, token: number) => (generation.get(key) ?? 0) === token,
    reloaded: (key: string, at = Date.now()) => {
      generation.set(key, (generation.get(key) ?? 0) + 1);
      reloadedAt.set(key, at);
    },
    lastReloadAt: (key: string) => reloadedAt.get(key) ?? 0,
  };
}
