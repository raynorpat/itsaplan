# Team estimates and the estimate picker

## Intent

Issues store an estimate but the app cannot set one, and teams cannot choose how they
estimate. Linear has a per-team estimate scale and an estimate picker; this adds both.

## Goals

- **Team settings → Estimates** (team managers, as other team settings; also Linear's
  `teamUpdate` and `Team` fields): `issueEstimationType` (`notUsed`, `exponential`,
  `fibonacci`, `linear`, `tShirt`), `issueEstimationExtended`,
  `issueEstimationAllowZero`, `defaultIssueEstimate` (default 1).
  `inheritIssueEstimation` reads false (no sub-teams).
- **Scales** (Linear's): exponential 1, 2, 4, 8, 16 (extended 32, 64); Fibonacci 1, 2, 3,
  5, 8 (extended 13, 21); linear 1, 2, 3, 4, 5 (extended 6, 7); T-shirt XS, S, M, L, XL
  stored as 1, 2, 3, 5, 8 (extended XXL 13, XXXL 21); "allow zero" adds 0.
- **New and existing teams start with estimates off** (`notUsed`). While off: no picker,
  chip or Estimate ordering in the app; stored values are kept and hidden; an estimate
  set through the API is INVALID_INPUT.
- **Validation:** `issueCreate` / `issueUpdate` / batch updates refuse an estimate not on
  the team's scale (INVALID_INPUT); `null` clears. Moving an issue to another team keeps
  its estimate when valid there, else clears it (recorded in history as an estimate
  change). Changing a team's scale keeps existing values (Linear).
- **Picker:** on the issue page's properties, in the issue context menu and the command
  palette ("Set estimate"), and opened by the list / board estimate chip; T-shirt teams
  see sizes. Guests read only. The chip and Estimate ordering show only for teams with
  estimates on.
- **Progress:** cycle and project progress count an unestimated issue as the team's
  `defaultIssueEstimate` (today's rule counts 1, so default figures are unchanged).

## Non-goals

- Sub-team inheritance, estimate filters beyond the existing `estimate` comparator,
  per-project scales.

## Approaches

1. **Linear's team fields and scales (chosen).**
2. A free-number estimate with no scale. Rejected: not Linear, and Linear clients expect
   the team scale.

## Left to the builder

Columns and migration, where the picker sits in each menu, the T-shirt label mapping
helper's location (shared by web and API), the order of the work.
