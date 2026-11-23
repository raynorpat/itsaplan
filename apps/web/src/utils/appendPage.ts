// Adds a "Load more" page to the loaded rows. A row the page repeats (the list
// shifted because a row was created or moved between pages) keeps its first
// position and takes the page's newer copy.
export function appendPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  const index = new Map(current.map((row, i) => [row.id, i]));
  const out = [...current];
  for (const row of page) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, out.length);
      out.push(row);
    } else out[at] = row;
  }
  return out;
}
