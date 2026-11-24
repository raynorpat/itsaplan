// One page of a GraphQL connection, as Linear's connections return it.
export interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

// Loads a whole list from a GraphQL connection: asks for `first` items after each
// page's endCursor until a page says there is no next one, and returns every node in
// the order the pages came. Lists the web filters in the browser (a team's active
// issues, the viewer's notifications) load this way.
export async function fetchAllPages<T>(
  fetchPage: (after: string | null, first: number) => Promise<Page<T>>,
  first = 250,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await fetchPage(after, first);
    all.push(...page.nodes);
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return all;
    after = page.pageInfo.endCursor;
  }
}

// Loads a GraphQL connection like fetchAllPages but stops after `limit` items, asking
// the last page for only what is left. `capped` is true when the connection held more.
export async function fetchPagesUpTo<T>(
  fetchPage: (after: string | null, first: number) => Promise<Page<T>>,
  limit: number,
  first = 250,
): Promise<{ nodes: T[]; capped: boolean }> {
  const nodes: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await fetchPage(after, Math.min(first, limit - nodes.length));
    nodes.push(...page.nodes);
    const more = page.pageInfo.hasNextPage && !!page.pageInfo.endCursor;
    if (!more) return { nodes, capped: false };
    if (nodes.length >= limit) return { nodes: nodes.slice(0, limit), capped: true };
    after = page.pageInfo.endCursor!;
  }
}
