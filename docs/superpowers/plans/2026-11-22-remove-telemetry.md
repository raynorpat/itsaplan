# Remove Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the anonymous daily telemetry pulse from the worker, together with its docs, environment variables and stored state.

**Architecture:** Telemetry is one self-contained feature in `apps/worker`: `telemetry.ts` (state, SQL counts, HTTP send), two pure helpers (`telemetry-payload.ts`, `telemetry-schedule.ts`) with unit tests, and one call site in `worker.ts`. Removal deletes those files, the call site, the opt-out variables in `.env.example` and both deploy compose files, `TELEMETRY.md`, and the `telemetry.*` rows in `app_setting`.

**Tech Stack:** Bun, TypeScript, Drizzle (PostgreSQL), Docker Compose.

**Spec:** none. The requirement is the user's request: "remove the telemetry code completely".

## Global Constraints

- Agents do not commit (root `AGENTS.md`). Each task ends with a proposed Conventional Commit message for the user.
- Commit scope: `worker` for worker-only changes; no scope when a change spans several apps/packages or root files.
- Write the final state in docs and comments. Do not leave notes such as "telemetry was removed".
- A deploy-stack change lands in both `docker-compose.yml` and `docker-compose.coolify.yml`.

## Out of scope (keep as is)

- `ENV NEXT_TELEMETRY_DISABLED=1` in `apps/web/Dockerfile:37,43`. It turns off Next.js's own telemetry. Removing it would turn that telemetry on.
- `apps/worker/src/backoff.ts`, `getOrCreateSetting` in `@repo/db`, and `resolveJsonModule` in `tsconfig.base.json`. Each still has other users (`agent-runs.ts`, `notification-delivery.ts`, `graphql/resolvers/organization.ts`, `api/src/settings/updates.ts`).
- PostHog/Sentry strings in `apps/api/src/graphql/schema.graphql`. They are part of the Linear API schema copy, not telemetry.
- Historical plan/spec docs under `docs/superpowers/`. They record past work.
- The collector service at `https://telemetry.itsaplan.dev`. It is not in this repo; shutting it down is a separate operational step for the user.

## Branching

The stage 8 working tree (`feat/linear-stage8`) has an uncommitted edit to `apps/worker/src/telemetry.ts` (the `attachment` table rename in the count query). Do this work on a new branch from `main` (`chore/remove-telemetry`). Whichever branch merges second gets a delete/modify conflict on `telemetry.ts`; resolve it by keeping the file deleted (`git rm apps/worker/src/telemetry.ts`).

## Review Focus

1. Worker tick still runs cleanup, auto-archive and cycle upkeep on their own intervals after the telemetry block is removed — check `worker.ts` diff only drops the telemetry lines.
2. An operator who still sets `TELEMETRY_DISABLED`, `DO_NOT_TRACK` or `TELEMETRY_DEBUG` in `.env` sees no error — compose files must not reference them with `${VAR:?}`; removing the lines is enough, unknown `.env` keys are ignored.
3. The cleanup migration only deletes keys with the `telemetry.` prefix — any other `app_setting` row (registration gate, organization, etc.) is untouched.
4. No dangling import of `./telemetry*` anywhere — `bun run typecheck` catches it.
5. `bun install --frozen-lockfile` still passes — no dependency was added for telemetry, so `package.json`/`bun.lock` must stay unchanged.

---

### Task 1: Remove the telemetry code and its configuration

**Files:**
- Delete: `apps/worker/src/telemetry.ts`
- Delete: `apps/worker/src/telemetry-payload.ts`
- Delete: `apps/worker/src/telemetry-schedule.ts`
- Delete: `apps/worker/src/__tests__/unit/telemetry-payload.test.ts`
- Delete: `apps/worker/src/__tests__/unit/telemetry-schedule.test.ts`
- Delete: `TELEMETRY.md`
- Modify: `apps/worker/src/worker.ts:8` (import), `:23-24` (`ticksSinceTelemetry` and its comment), `:30-32` (tick comment), `:73-80` (telemetry block)
- Modify: `.env.example:89-92` (the "Anonymous telemetry" block, including the blank line before the next section so spacing stays one line)
- Modify: `docker-compose.yml:121-125` and `docker-compose.coolify.yml:113-117` (comment + `TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `TELEMETRY_DEBUG` lines in the `worker` service `environment`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. After this task no code references `processTelemetry`, `TELEMETRY_CHECK_EVERY_TICKS`, `buildPulse` or `shouldSend`.

- [ ] **Step 1: Delete the five worker files and `TELEMETRY.md`**

```bash
git rm apps/worker/src/telemetry.ts apps/worker/src/telemetry-payload.ts \
  apps/worker/src/telemetry-schedule.ts \
  apps/worker/src/__tests__/unit/telemetry-payload.test.ts \
  apps/worker/src/__tests__/unit/telemetry-schedule.test.ts TELEMETRY.md
```

- [ ] **Step 2: Edit `apps/worker/src/worker.ts`**

Remove the import, `ticksSinceTelemetry` with its comment, and the `if (++ticksSinceTelemetry …)` block. Change the tick comment to end with: "then run the delivery cleanup, the auto-archive sweep and the cycle upkeep on their own tick intervals." (cycle upkeep is already in the tick and missing from the current comment).

- [ ] **Step 3: Edit `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml`** as listed under Files.

- [ ] **Step 4: Confirm nothing references telemetry**

Run: `git grep -n -i -E 'telemetry|DO_NOT_TRACK' -- ':!docs/superpowers' ':!apps/api/src/graphql/schema.graphql'`
Expected: only the two `NEXT_TELEMETRY_DISABLED` lines in `apps/web/Dockerfile`.

- [ ] **Step 5: Run the gate**

Run: `bun run typecheck && bun run lint && bun run format:check && bun --filter='@repo/worker' run test`
Expected: all pass; the worker test count drops by the two deleted files. (If the worker package name differs, take it from `apps/worker/package.json`.)

Run: `docker compose -f docker-compose.yml config -q && docker compose -f docker-compose.coolify.yml config -q`
Expected: no output, exit 0 (needs the required secrets set in `.env`; if they are not, run with dummy values exported in the shell).

- [ ] **Step 6: Propose the commit**

```
feat(worker)!: remove anonymous telemetry
```

`!` because operators lose a documented feature and three environment variables; while the version is `0.x`, release-please bumps the minor.

### Task 2: Delete stored telemetry settings

The worker stored `telemetry.instance_id`, `telemetry.send_minute` and `telemetry.last_sent_day` in `app_setting`. Without this task the instance ID stays in every existing database.

**Files:**
- Create: `packages/db/drizzle/<NNNN>_drop_telemetry_settings.sql` (generated name; Drizzle picks the number)
- Modify: `packages/db/drizzle/meta/_journal.json` (generated)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing.

- [ ] **Step 1: Generate an empty custom migration**

Run: `bun --filter='@repo/db' run db:generate -- --custom --name=drop_telemetry_settings`
Expected: a new empty `.sql` file under `packages/db/drizzle/` and a journal entry.

- [ ] **Step 2: Write the statement**

```sql
DELETE FROM "app_setting" WHERE "key" LIKE 'telemetry.%';
```

- [ ] **Step 3: Apply and verify against the dev DB**

Run: `bun run db:migrate`, then `psql "$DATABASE_URL" -c "SELECT key FROM app_setting WHERE key LIKE 'telemetry.%'"`
Expected: migration applies; the query returns 0 rows, and other keys are still listed by `SELECT key FROM app_setting`.

- [ ] **Step 4: Run the test gate**

Run: `docker compose -f docker-compose.test.yml build && docker compose -f docker-compose.test.yml run --rm api-test`
Expected: exit 0.

- [ ] **Step 5: Propose the commit**

```
chore(db): delete stored telemetry settings
```

### Before pushing

Run `tidy`, then `code-review`, on the branch (root `AGENTS.md`). PR title: `feat!: remove anonymous telemetry` (no scope, since the PR spans `worker`, `db` and root files).
