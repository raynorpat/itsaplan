# Sorting follow-ups: estimate property and faster sorted paging

## Intent

Two gaps left by the sorting project: issue lists can be ordered by estimate but do not
show it, and sorted pages compute each sort value several times per row.

## Goals

- **Estimate display property** (Linear's): a Display menu toggle "Estimate", on by
  default; shown only for teams that use estimates (a team with estimates off never shows
  it). On list rows and board cards a chip with the estimate icon and value; clicking
  opens the issue page's estimate picker (read-only for guests). Saved views and My
  issues keep the toggle like the other properties.
- **Sorted paging computes each sort value once per row:** the shared helper
  (`apps/api/src/graphql/sort.ts`) runs each list's base query as an inner query that
  selects the sort values under aliases; ORDER BY and the cursor condition use the
  aliases. Results are identical to today's.

## Non-goals

- New sort keys, backward paging, changes to which lists sort.

## Approaches

1. **Inner query with aliased sort values (chosen).** One change in the helper; each
   list's loader hands over its base query.
2. Indexes or generated columns per key. Rejected: most keys are correlated subqueries
   over other tables and cannot be indexed that way.

## Left to the builder

The loader contract change, the estimate chip's exact look within DESIGN.md, and how the
"computed once" check is tested (for example by counting a deliberately side-effecting
SQL function in a test, or by inspecting the generated SQL).
