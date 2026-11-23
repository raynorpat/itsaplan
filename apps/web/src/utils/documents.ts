// A document's title as shown in lists and headers.
export function documentTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  return trimmed || 'Untitled';
}

// An issue's documents, most recently updated first, then by title.
export function sortDocuments<T extends { title: string; updatedAt: string }>(docs: T[]): T[] {
  return [...docs].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
}
