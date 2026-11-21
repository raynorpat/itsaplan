# Stage 4: Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's cycles over `/graphql` — team cycle settings, cycles with scheduled upkeep and rollover, issue membership, progress and history.

**Architecture:** Cycle rules live in `apps/api/src/cycles/` (store + schedule). The worker calls `POST /internal/cycles/tick` hourly; the API runs upkeep through the store, so changes log to the feed and send webhooks. GraphQL resolvers and REST call the same store functions.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-21-linear-graphql-stage4-cycles-design.md`

## Global Constraints

- API-only: no web UI changes beyond keeping the web compiling.
- UTC days. A cycle starts 00:00 UTC on `cycle_start_day` (0 = Sunday … 6 = Saturday), lasts `cycle_duration` weeks (1–8), the next starts `cycle_cooldown_time` weeks (0–3) after; `upcoming_cycle_count` 1–10. Defaults: disabled, 2 weeks, Monday (1), cooldown 0, 2 upcoming, auto-assign off.
- No overlapping cycles in a team; an issue's cycle belongs to its team; past cycles are never backfilled; rollover moves unfinished (state type not completed/canceled, not archived) issues into the cycle containing now.
- Progress: completed 1, started 0.25, canceled excluded; estimate-weighted when the cycle's estimate total is nonzero (null estimate counts 1); 0 when nothing eligible; 0.999 instead of 1 while open zero-estimate issues remain.
- Cycle writes need the team's `work_items.<action>`; team cycle settings and `teamUpdate` need team owner.
- Upkeep functions take an explicit `now: Date` (tests pass a fixed date; the route passes `new Date()`).
- Baseline migration regenerated on schema change (save the seed block, delete the `.sql` and the two `meta/` files by name, `rmdir` meta, `db:generate`, append seed, reset the `*_test` DB, `db:migrate:test`).
- Unsupported GraphQL input → INVALID_INPUT naming the field.
- Commit after each task, no trailer (user instruction).

## Review Focus

1. A long gap (all cycles ended, none containing now): upkeep creates the current cycle after the latest one, rolls unfinished issues straight into it, and creates no past cycles. Test in Task 2.
2. Re-enabling with existing cycles creates no overlap, and cycles that ended while disabled are closed with rollover on the next tick. Test in Task 2.
3. Rollover never moves completed, canceled or archived issues, and records only the moved ones in `uncompletedIssuesUponClose`. Test in Task 2.
4. An explicit `cycleId` (including null) in the same write wins over auto-assign; auto-assign also applies on create and between started states. Test in Task 3.
5. Closing by hand sets `endsAt = completedAt` and rolls over; `completedAt` on a future cycle or in the future → INVALID_INPUT; archiving the active cycle → INVALID_INPUT. Test in Task 4.

---

### Task 1: Schema, settings and cycle store

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`team` cycle columns + `next_cycle_number`; `cycle` table per spec; `issue.cycle_id` FK set null, index), regenerate baseline
- Create: `apps/api/src/cycles/store.ts`, `apps/api/src/cycles/schedule.ts`
- Modify: `apps/api/src/teams/routes.ts` + `teams/store.ts` (settings route `cycles` object), `apps/web/src/lib/api.ts` only if types break
- Test: `apps/api/src/cycles/__tests__/unit/schedule.test.ts`, `apps/api/src/cycles/__tests__/integration/cycles.test.ts`

**Interfaces:**
- Produces (`schedule.ts`, pure): `interface CycleSettings { duration: number; startDay: number; cooldown: number; upcoming: number }`; `currentCycleStart(settings, now: Date): Date` (most recent start day at or before `now`, 00:00 UTC); `nextCycleStart(prevEnd: Date, settings): Date` (`prevEnd + cooldown weeks`, then the next start day at or after it); `cycleEnd(start: Date, settings): Date`.
- Produces (`store.ts`): `CycleRow { id; teamId; number; name; description; startsAt; endsAt; completedAt; archivedAt; issueCountHistory: number[]; completedIssueCountHistory: number[]; scopeHistory: number[]; completedScopeHistory: number[]; inProgressScopeHistory: number[]; uncompletedIssueIdsUponClose: string[]; createdAt; updatedAt }`; `getCycle(id)`, `listCycles(teamId, { includeArchived? })`, `createCycle(teamId, input: { startsAt: Date; endsAt: Date; name?; description?; id? }, actorUserId)` (400 overlap / cycles disabled; number under team row lock; Cycle `create` webhook), `teamCycleSettings(teamId): Promise<CycleSettings & { enabled: boolean; autoAssignStarted: boolean; autoAssignCompleted: boolean }>`, `setTeamCycleSettings(teamId, patch, actorUserId)` (validates ranges, 400; enabling calls `ensureCycles(teamId, new Date())`), `activeCycle(teamId, now)`.
- REST: `PATCH /teams/:teamKey/settings` body gains `cycles: { enabled?, duration?, startDay?, cooldown?, upcoming?, autoAssignStarted?, autoAssignCompleted? }`; response gains `cycles` with all seven.

- [ ] **Step 1: Write the failing tests:**
  - unit: `currentCycleStart` for a Wednesday with start day Monday → that week's Monday 00:00 UTC; `nextCycleStart` with cooldown 1 and start day Monday → the Monday 1 week after the end; duration 2 → end 14 days after start.
  - integration: `enabling cycles creates the current and two upcoming cycles` (settings PATCH `{ cycles:{ enabled:true } }` → `listCycles` has 3, numbers 1–3, contiguous with no overlap); `rejects out-of-range settings` (duration 9, cooldown 4, upcoming 11, startDay 7 → 400); `createCycle rejects an overlap and a disabled team` (store calls → 400).
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/cycles` — Expected: FAIL.
- [ ] **Step 3: Implement** (regenerate baseline per Global Constraints).
- [ ] **Step 4: Run** — Expected: PASS; root `bun run typecheck` 0 errors.
- [ ] **Step 5: Commit** `feat: add cycles and team cycle settings`

### Task 2: Upkeep (close, rollover, upcoming, history) and the internal route

**Files:**
- Modify: `apps/api/src/cycles/store.ts`
- Create: `apps/api/src/cycles/internal-routes.ts` (registered in `app.ts`), worker: `apps/worker/src/internal-api.ts` (`runCycleUpkeep()`), `worker.ts` + `config.ts` (`CYCLE_UPKEEP_EVERY_TICKS`, default 1800 ≈ hourly), `.env.example`
- Test: `apps/api/src/cycles/__tests__/integration/upkeep.test.ts`

**Interfaces:**
- Produces: `ensureCycles(teamId: string, now: Date): Promise<void>` (step 1 + step 3 of the spec), `closeEndedCycles(teamId, now)` (step 2), `recordHistory(teamId, now)` (step 4), `runUpkeep(now: Date): Promise<void>` (all teams with cycles enabled, steps in spec order), `closeCycle(cycleId, closedAt: Date, actorUserId: string | null)` (shared with Task 4: sets `completed_at`, `ends_at = closedAt` when earlier, records unfinished ids, moves them to the cycle containing `closedAt`… using `updateIssue` with `{ cycleId }` so feed and webhooks follow; Cycle `update` webhook).
- `POST /internal/cycles/tick` (worker token) runs `runUpkeep(new Date())`.
- `cycleProgress(cycleId): Promise<{ progress; total; completed; started; scope; completedScope; inProgressScope }>` in `store.ts` (Global Constraints formula), used by history and GraphQL.

- [ ] **Step 1: Write the failing tests** (fixed `now` values, issues created through REST, their `cycleId` set through the store until Task 3):
  - `closes an ended cycle and rolls unfinished issues into the current one` (Review Focus 3): one started, one completed, one canceled, one archived issue in cycle 1; `runUpkeep(now in cycle 2)` → cycle 1 `completedAt` = its `endsAt`, `uncompletedIssueIdsUponClose` = [started], started issue now in cycle 2, the others unchanged; the issue feed shows the cycle change; an Issue webhook with `updatedFrom.cycleId`.
  - `keeps the configured number of upcoming cycles`.
  - `skips ahead after a long gap without creating past cycles` (Review Focus 1): enable at week 0, `runUpkeep(week 10)` → the new current cycle contains week 10 and starts after the latest existing cycle's end; unfinished issues from the ended cycles are in it; no cycle starts and ends between the old last cycle and the new current one.
  - `re-enabling creates no overlap and closes cycles ended while disabled` (Review Focus 2).
  - `appends one history entry per day and catches up missed days` (`recordHistory` at day 1, then day 4 → arrays length 4).
  - `the internal route needs the worker token` → 401.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/cycles` — Expected: FAIL.
- [ ] **Step 3: Implement**; the worker call follows `notifyIssuesArchived` (try/catch, logs, does not fail the tick).
- [ ] **Step 4: Run** — Expected: PASS; worker unit tests and typecheck pass.
- [ ] **Step 5: Commit** `feat: run cycle upkeep from the worker`

### Task 3: Issues in cycles

**Files:**
- Modify: `apps/api/src/issues/store.ts` (`IssuePatch.cycleId`, `createIssue` input `cycleId`, check the cycle belongs to the team and is not archived, auto-assign), `apps/api/src/issues/routes.ts` (REST body + DTO `cycleId`), `apps/api/src/webhooks/data.ts` (`cycleId` comes from `toIssue`), `apps/api/src/graphql/resolvers/issue.ts` (`toIssue.cycleId`), `apps/web/src/lib/api.ts` (`Issue.cycleId`)
- Test: `apps/api/src/cycles/__tests__/integration/issue-cycles.test.ts`

**Interfaces:**
- Produces: `IssuePatch.cycleId?: string | null`; activity action `cycle` (from/to cycle names `Cycle N` or the name); auto-assign helper `autoAssignCycleId(teamId, stateType, current: string | null, explicit: string | null | undefined, now): Promise<string | null | undefined>`.

- [ ] **Step 1: Write the failing tests:**
  - `sets and clears an issue's cycle over REST` → DTO `cycleId`; feed `cycle` entry.
  - `rejects another team's cycle and an archived cycle` → 400.
  - `auto-assigns on moving to a started state, on create in a started state, and between started states` (Review Focus 4).
  - `an explicit cycleId, including null, wins over auto-assign` (Review Focus 4).
  - `auto-assign completed` with only that setting on.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/cycles src/issues` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: put issues in cycles`

### Task 4: GraphQL

**Files:**
- Create: `apps/api/src/graphql/resolvers/cycle.ts`, `apps/api/src/graphql/cycle-filter.ts`, register in `mount.ts`
- Modify: `apps/api/src/graphql/issue-filter.ts` (`cycle`), `apps/api/src/graphql/resolvers/mutations.ts` (`cycleId` in issue inputs), `apps/api/src/graphql/resolvers/team.ts` (team cycle fields; `teamUpdate`), `apps/api/src/cycles/store.ts` (`updateCycle`, `archiveCycle`), `apps/api/src/webhooks/store.ts` + web resource list (`Cycle`)
- Test: `apps/api/src/graphql/__tests__/integration/cycles.test.ts`

**Interfaces:**
- Produces: `updateCycle(id, patch: { name?; description?; startsAt?: Date; endsAt?: Date; completedAt?: Date }, actorUserId, now)` (overlap 400; `completedAt` → `closeCycle`, rules per spec); `archiveCycle(id, actorUserId, now)` (active → 400; future → clears its issues' `cycle_id`; Cycle `remove` webhook).
- GraphQL per spec: `cycle(id)`, `cycles(filter)`, `Team.{cycles, activeCycle, cyclesEnabled, cycleDuration, cycleStartDay, cycleCooldownTime, upcomingCycleCount, cycleIssueAutoAssignStarted, cycleIssueAutoAssignCompleted}`, `Issue.cycle`, `Cycle.{issues, uncompletedIssuesUponClose, team, progress, isActive, isFuture, isNext, isPast, isPrevious, issueCountHistory, completedIssueCountHistory, scopeHistory, completedScopeHistory, inProgressScopeHistory}`; `cycleCreate`, `cycleUpdate`, `cycleArchive`, `teamUpdate` (`name`, `description`, the seven cycle fields).

- [ ] **Step 1: Write the failing tests** (SDK):
  - `teamUpdate enables cycles and reads them back` (`team.activeCycle` exists, `team.cycles()` has 3); `teamUpdate` with `timezone` → INVALID_INPUT naming it; non-owner member → FORBIDDEN.
  - `cycleCreate` after the last automatic cycle succeeds and one overlapping it → INVALID_INPUT; `cycleUpdate` renames.
  - `closing by hand sets endsAt and rolls over` (Review Focus 5); `completedAt` on a future cycle → INVALID_INPUT; archiving the active cycle → INVALID_INPUT; archiving a future cycle clears its issues.
  - `progress follows Linear's formula`: 2 completed + 2 started + 1 canceled, no estimates → (2 + 0.5)/4 = 0.625; with estimates 3 (completed) and 1 (started, unestimated counts 1) → (3 + 0.25)/4 = 0.8125.
  - `issues(filter: { cycle: { id: { eq } } })` and `{ cycle: { null: true } }`; `createIssue({ cycleId })`.
  - `isActive / isNext / isPrevious` flags on a sequence of cycles.
  - Cycle webhook `create` on `cycleCreate`.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/graphql/__tests__/integration/cycles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `src/graphql src/cycles src/webhooks` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): manage cycles over GraphQL`

### Task 5: Finish

- [ ] Update `apps/api/AGENTS.md` (cycles section, GraphQL coverage), `apps/worker/AGENTS.md` (cycle upkeep tick), README feature line, the staged-plan memory.
- [ ] Root `format:check`, `lint`, `typecheck`, `build`; API suite (only S3-dependent failures); worker unit tests.
- [ ] tidy; fresh whole-branch review on the most capable model with this plan's Review Focus; fix Critical/Important test-first.
- [ ] Commit `docs: describe cycles`.
