// The time before which a feed merged from several newest-first connections is
// incomplete: a connection with older pages may be missing entries older than its
// oldest loaded one, so the feed stops there (the latest such time when several have
// more). Null when every connection is fully loaded.
export function pagedCutoff(
  connections: { rows: { createdAt: string }[]; hasMore: boolean }[],
): string | null {
  const cuts = connections
    .filter((c) => c.hasMore && c.rows.length > 0)
    .map((c) =>
      c.rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), c.rows[0]!.createdAt),
    );
  return cuts.length ? cuts.sort().at(-1)! : null;
}
