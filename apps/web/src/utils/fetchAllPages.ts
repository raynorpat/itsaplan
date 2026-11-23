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
