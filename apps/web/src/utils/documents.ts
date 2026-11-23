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

// Reconciles an edited field with the server's value. `synced` is the server value
// the draft was last based on. A new server value replaces the draft only when the
// field is not being edited and holds no unsaved change; a server value equal to the
// draft (the field's own save coming back) is accepted as the new base.
export function syncDraft(input: {
  server: string;
  draft: string;
  synced: string;
  editing: boolean;
}): { draft: string; synced: string } {
  const { server, draft, synced, editing } = input;
  if (server === synced) return { draft, synced };
  if (draft === server) return { draft, synced: server };
  if (!editing && draft === synced) return { draft: server, synced: server };
  return { draft, synced };
}
