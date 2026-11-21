# Linear-compatible GraphQL API — Stage 4: cycles

Follows stages 1–3 (`2026-11-20-linear-graphql-stage1-design.md`,
`2026-11-21-linear-graphql-stage2-projects-design.md`,
`2026-11-21-linear-graphql-stage3-comments-labels-design.md`) and the webhooks
design (`2026-11-21-linear-webhooks-design.md`).

## Intent

Linear tools and `@linear/sdk` work against a self-hosted instance. Stage 4 adds
Linear's cycles: time-boxed iterations per team, created ahead of time, closed on
schedule with unfinished issues rolled into the next cycle, and readable with their
progress and daily history. Standing rule: when unsure, do what Linear does.

## Goals

- Team cycle settings with Linear's field names and defaults.
- A `cycle` table and `issue.cycle_id`.
- Scheduled upkeep: upcoming cycles kept ahead, ended cycles closed with rollover,
  a daily history snapshot of active cycles.
- Auto-assigning started / completed issues to the active cycle.
- GraphQL: cycle queries and relations, `cycleCreate`, `cycleUpdate`,
  `cycleArchive`, team settings through `teamUpdate`, `cycleId` on issue mutations,
  the `cycle` issue filter.
- REST: `cycleId` on the issue patch; cycle settings on the team settings route.
- Webhooks: a `Cycle` resource type; Issue updates carry `cycleId`.

## Non-goals

- Web UI for cycles (settings, issue field, cycle views). API-only in this stage.
- Cycles inherited from a parent team (`inheritedFrom`), team time zones, the
  cycle calendar URL, `cycleLockToActive`.
- `cycleShiftAll`, `cycleStartUpcomingCycleToday` and other root mutations not
  listed under GraphQL; they stay NOT_IMPLEMENTED.

## Anti-goals

- An issue in a cycle of another team.
- Two cycles of a team overlapping in time.
- Rollover moving an issue that is completed or canceled.
- Upkeep that depends on running exactly once per period: a missed hour or day
  must be caught up from dates, not tick counts.

## Approaches

1. **The worker triggers, the API does the work (chosen).** The worker calls an
   internal API route hourly; the API creates missing upcoming cycles, closes ended
   cycles with rollover, and records the daily snapshot, through the normal store
   functions. Every change is logged to the issue feed, sends webhooks and follows
   the same rules as a hand edit. Upkeep pauses while the API is down and catches up
   on the next call because each step works from dates.
2. **The worker does it in SQL and reports ids.** Rejected: rollover rules would
   live in worker SQL and the API store, and moved issues would get no feed entries
   unless the SQL wrote them too — the split already patched for auto-archive.

History is stored as arrays on the cycle row, one value appended per day, rather
than a snapshot table: Linear exposes them as arrays and they are only read whole.

## Data model

The baseline migration is regenerated (no data to keep); the dev database is reset
before `db:migrate`.

### `team` gains

| column                               | default | notes                                   |
| ------------------------------------ | ------- | --------------------------------------- |
| `cycles_enabled`                     | false   |                                         |
| `cycle_duration`                     | 2       | weeks, 1–8                              |
| `cycle_start_day`                    | 1       | 0 = Sunday … 6 = Saturday (Linear)      |
| `cycle_cooldown_time`                | 0       | weeks, 0–3 (Linear's `TeamUpdateInput`) |
| `upcoming_cycle_count`               | 2       | 1–10 (Linear's range)                   |
| `cycle_issue_auto_assign_started`    | false   |                                         |
| `cycle_issue_auto_assign_completed`  | false   |                                         |

### `cycle`

| column                         | notes                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| `id`                           | uuid                                                           |
| `team_id`                      | FK team, cascade                                               |
| `number`                       | integer, unique per team, assigned in order                    |
| `name`, `description`          | text, nullable                                                 |
| `starts_at`, `ends_at`         | timestamptz; `ends_at > starts_at`                             |
| `completed_at`                 | timestamptz, nullable                                          |
| `archived_at`                  | timestamptz, nullable                                          |
| `issue_count_history`          | integer[] — total issues, one per day since start              |
| `completed_issue_count_history`| integer[]                                                      |
| `scope_history`                | real[] — estimate-weighted total (issue count when no estimates)|
| `completed_scope_history`      | real[]                                                         |
| `in_progress_scope_history`    | real[]                                                         |
| `uncompleted_issue_ids_upon_close` | uuid[] — snapshot at close                                 |
| `created_at`, `updated_at`     |                                                                |

`team.next_cycle_number` (default 1) issues numbers under a row lock, like issue
sequence numbers.

`issue.cycle_id` FK cycle, set null on delete. An issue's cycle belongs to its team.

## Scheduling

All dates are UTC days (teams have no time zone yet).

- **Cycle boundaries.** A cycle starts at 00:00 UTC on the team's start day and
  lasts `cycle_duration` weeks; the next starts `cycle_cooldown_time` weeks after
  the previous one ends.
- **Enabling cycles** keeps existing cycles. If no cycle of the team contains now,
  a current cycle is created starting on the most recent start day at or before
  today — or, when that would overlap an existing cycle, at the end of the latest
  one (after the cooldown). Upcoming cycles then follow the latest cycle. Disabling
  stops upkeep; existing cycles stay and the active one is left as it is (Linear).
  Cycles that ended while cycles were disabled are closed, with rollover, by the
  first upkeep after re-enabling.
- **`cycleCreate` needs cycles enabled** on the team (INVALID_INPUT otherwise).
- **Changing duration, start day or cooldown** applies to cycles created afterwards;
  existing ones keep their dates.
- **Upkeep (hourly, `POST /internal/cycles/tick`, worker token)**, for each team with
  cycles enabled, in this order:
  1. Make sure a cycle contains now (create it after the latest cycle, as on
     enabling). Past cycles are never backfilled: after a long gap the schedule
     skips ahead to the cycle that contains today.
  2. Close every cycle whose `ends_at` has passed and `completed_at` is null: set
     `completed_at = ends_at`, record the unfinished issue ids (state type not
     completed or canceled, issue not archived), and move those issues to the
     current cycle (the one containing now), logging the change and sending Issue
     webhooks with no actor. Issues never hop through several ended cycles.
  3. Create cycles until the team has `upcoming_cycle_count` non-archived cycles
     starting after now.
  4. For each active cycle, append today's values to the history arrays when the
     arrays have fewer entries than days since the cycle started (catching up
     missed days with the current values).
- **Auto-assign:** when an issue is created in, or moves to, a started state and
  `cycle_issue_auto_assign_started` is on (or a completed state and
  `cycle_issue_auto_assign_completed` is on), and it has no cycle, it joins the
  team's active cycle if one exists. This covers moves between two started states.
  A `cycleId` given in the same write (including null) wins over auto-assign.
- **Closing by hand:** `cycleUpdate` with `completedAt` closes the active cycle
  early: `ends_at` becomes `completedAt` (Linear), and the close runs the same
  rollover as upkeep. `completedAt` cannot be cleared, set on a future or already
  completed cycle, or set in the future (INVALID_INPUT).
- **Archiving:** `cycleArchive` archives a completed or future cycle (the active
  cycle cannot be archived: INVALID_INPUT). Archiving a future cycle removes its
  issues from it (`cycle_id` cleared, Linear). Archived cycles are never rollover
  targets and do not count as upcoming.
- Hand-made cycles (`cycleCreate`) must not overlap another cycle of the team
  (400 / INVALID_INPUT); upkeep continues after the last cycle.

## Progress

`progress` (0–1): completed issues count 1, started issues count 0.25; canceled
issues are excluded. Weighted by estimate when the cycle's estimate total is
nonzero, otherwise by issue count. In weighted mode an issue without an estimate
counts as 1 (Linear's default estimate; teams have no estimate settings here). 0 when nothing is eligible; 0.999 instead of 1
while open issues with zero estimate remain (Linear). `isActive` (now between
start and end, not completed), `isFuture`, `isPast`, `isNext` (the earliest future
cycle), `isPrevious` (the most recently completed cycle).

## Access

- Cycles are visible to members of their team; creating, changing and archiving a
  cycle needs the team's `work_items` permission for that action (members manage
  cycles in Linear by default). No separate `cycles` permission resource: one would
  also need the web role editor, which this API-only stage does not change.
- Team cycle settings are changed with the team settings permission (owners), as
  the other team settings.
- Over MCP the existing team gates apply.

## GraphQL

- Queries: `cycle(id)`, `cycles(filter)` (CycleFilter: `id`, `number`, `name`,
  `startsAt`, `endsAt`, `completedAt`, `isActive`, `isFuture`, `isPast`, `isNext`,
  `isPrevious`, `team`, `and`, `or`), `Team.cycles`, `Team.activeCycle`,
  `Issue.cycle`, `Cycle.issues`, `Cycle.uncompletedIssuesUponClose`, `Cycle.team`.
- Team fields: `cyclesEnabled`, `cycleDuration`, `cycleStartDay`,
  `cycleCooldownTime`, `upcomingCycleCount`, `cycleIssueAutoAssignStarted`,
  `cycleIssueAutoAssignCompleted`. A new `teamUpdate` mutation accepts these plus
  `name` and `description`, with the REST permissions (team owner for all of them);
  every other `TeamUpdateInput` field is INVALID_INPUT naming it.
- Mutations: `cycleCreate` (`teamId`, `startsAt`, `endsAt`, `name`, `description`,
  `id`), `cycleUpdate` (`name`, `description`, `startsAt`, `endsAt`, `completedAt`),
  `cycleArchive`. Issue mutations accept `cycleId`; `IssueFilter.cycle` supports
  `id`, `number`, `null`, `isActive`, `isNext`, `isPrevious`.

## Webhooks

`Cycle` resource type: `create`, `update` (including close), `remove` (archive).
Issue updates from rollover and auto-assign carry `cycleId` in `updatedFrom`.

## Testing

API integration tests (stage rules). Upkeep is tested by calling the internal
route with a fixed "now" supplied through a test-only clock helper in the cycles
store (left to the builder: a `now` parameter on the upkeep function, not an env
var), covering: enabling creates current + upcoming; closing rolls over only
unfinished issues and records them; a missed week catches up; history appends per
day and catches up missed days; auto-assign on start / completion; overlap
rejected; issue in another team's cycle rejected; progress formula cases.

## Left to the builder

- File layout (`apps/api/src/cycles/`), the internal route module, and the worker
  tick cadence wiring (hourly, following the auto-archive pattern).
