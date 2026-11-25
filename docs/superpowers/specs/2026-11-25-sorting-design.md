# Sorting

## Intent

Linear tools and scripts send `sort` on list queries and get refused here today; and the
app offers fewer ways to order issues than Linear does. This project makes every `sort`
argument in Linear's schema work and adds Linear's missing issue orderings to the app.

## Goals

### The API (user's choice: Approach 1)

- Every query or connection field whose Linear signature takes `sort` accepts it, with
  Linear's keys:
  - **Issues** (`IssueSortInput`, wherever the SDL offers it): assignee, completedAt,
    createdAt, customer, customerCount, customerImportantCount, customerRevenue, cycle,
    delegate, dueDate, estimate, label, labelGroup, linkCount, manual, milestone,
    priority, project, release, rootIssue, team, title, updatedAt, workflowState.
    `slaStatus` is INVALID_INPUT (no SLAs here).
  - **Projects:** createdAt, health, lead, manual, name, priority, startDate, status,
    targetDate, updatedAt.
  - **Initiatives:** createdAt, health, healthUpdatedAt, manual, name, owner, priority,
    targetDate, updatedAt.
  - **Users:** displayName, name. **Documents:** createdAt, creator, project, title,
    updatedAt. **Custom views:** createdAt, name, shared, updatedAt. **Releases:** stage.
    **Release pipelines:** name. Customers keep their existing sorts.
- **Several keys** apply in the order given; each takes `order` (asc / desc) and `nulls`
  (first / last, default last), and the key-specific options Linear defines:
  `priority.noPriorityFirst` (No priority after Urgent…Low unless set),
  `workflowState.closedIssuesOrderedByRecency`, `manual` per the list's own manual order
  (an issue's `sortOrder`, a project's / initiative's sort order), and the related-item
  keys as Linear's schema describes them: cycle by start date (with
  `currentCycleFirst`), project by name, milestone by target date, release by the most
  recent release date, customer by name, customer revenue by revenue; the other
  per-key options (`typeOnly`, `usePrioritySortOrderTiebreaker`, …) as the SDL defines
  them (builder's call: the SDL's descriptions are Linear's behaviour).
- **Keys with several values per issue** (label, label group, customer, customer
  revenue, release): ascending uses the issue's lowest value, descending its highest
  (label and customer by name; customer revenue the largest customer's revenue; release
  its most recent release date; label group the issue's label inside that group)
  (builder's call).
- Each sort ends with the same tie-break chain as the app (an issue's manual
  `sortOrder`, then created date newest first, then id), so pages never overlap.
- **Paging stays correct while sorted:** `first` / `after` (and `last` / `before` where
  the list supports them) return consecutive pages with no row twice and none skipped,
  for any sort. Sorted lists page forward only (`first` / `after`); `last` / `before`
  with `sort` is INVALID_INPUT, as the existing sorted lists do (builder's call).
  `sort` together with `orderBy` uses `sort` (Linear: sort wins).
- **Access is unchanged:** a sort by a related item (assignee, project, cycle, customer…)
  never orders by, or reveals, something the viewer cannot see; a hidden related item
  sorts as empty (builder's call).
- Sorting by customers or customer revenue follows the Customers rules: while Customers
  is off, `customer` and `customerRevenue` sort as empty and `customerCount` counts
  people (as today).

### The app

- Issue lists, boards, saved views and My issues gain Linear's missing **orderings**:
  estimate, completed date, cycle, project, milestone, label (first label by name),
  release, link count, and — while Customers is on — customer count and customer revenue.
  Each starts in Linear's direction (completed date, link count and the customer
  orderings descending; the rest ascending). Ordering stays in the browser over the
  loaded issues (builder's call: the app already loads them). For the same sort, the app
  and the API use the same key, value rule, direction, empty placement and tie-break
  chain; text may differ in case or accent order between the browser's comparison and
  the database's collation (builder's call). The app's existing orderings (issue number,
  requests, status by column) stay as they are.
- **Initiatives** list becomes a table sortable by name, owner, health, target date and
  progress, as the projects list is (builder's call).
- Saved views store the new orderings in their view preferences as they store the
  existing ones.

## Non-goals

- Server-side paging of the app's issue lists; sorting lists whose Linear signature has no
  `sort`; SLA status; new sort keys Linear does not have.

## Anti-goals

- A page that repeats or skips a row while sorted.
- A sort that leaks the name or order of something the viewer cannot see.
- The app and the API ordering the same issues differently for the same sort (beyond
  text collation).

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Follow the AGENTS.md files and
  DESIGN.md. Settle open choices the way Linear does. No migration expected (indexes may
  be added in an incremental migration if a sort needs one).

## Approaches

1. **API sorts for every list plus the missing app orderings (chosen).**
2. API and app both sorted and paged on the server. Rejected: rewrites how boards load
   issues for no visible gain at current sizes.
3. Issue sorts only. Rejected: tools sorting projects, initiatives or people would still
   fail.

## Left to the builder

The cursor format for sorted pages, how sort keys are mapped to SQL, which indexes (if
any) are added, the order of the work, and the exact placement of the new orderings in
the display menu.
