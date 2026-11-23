// An issue's subscribers with the viewer first, then by name.
export function orderSubscribers<T extends { id: string; name: string }>(
  users: T[],
  viewerId: string | null,
): T[] {
  return [...users].sort((a, b) => {
    if (a.id === viewerId) return -1;
    if (b.id === viewerId) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isSubscribed(users: { id: string }[], viewerId: string | null): boolean {
  return viewerId != null && users.some((u) => u.id === viewerId);
}
