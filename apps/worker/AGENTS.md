# worker — rules

Webhook delivery worker: a standalone Bun process that drains the
`webhook_delivery` queue and posts signed payloads to subscriber URLs. Runs as its
own service (own Dockerfile), separate from `apps/api`. See root `AGENTS.md`.

## What it does

- Polls `webhook_delivery` for due `pending` rows, claims a batch with
  `FOR UPDATE SKIP LOCKED`, posts each to its webhook URL, records the outcome.
- Delivers in Linear's webhook format (https://linear.app/developers/webhooks), so
  a receiver written for Linear verifies it unchanged. The API builds the payload;
  the worker sets `webhookTimestamp` (send time, Unix ms) in the body, then sends
  `Linear-Signature` (hex HMAC-SHA256 of the raw body, keyed with the webhook's
  `secret`), `Linear-Delivery` (the event id, stable across retries),
  `Linear-Event` (the resource type), `Linear-Timestamp` and
  `User-Agent: Linear-Webhook`.
- Only HTTP 200 is success. Any other status, a network error or the 5 s timeout
  fails the attempt; it is retried 3 times, after 1 minute, 1 hour and 6 hours,
  then marked failed. After `WEBHOOK_DISABLE_THRESHOLD` consecutive failed
  deliveries the webhook is auto-disabled; a webhook a user disabled stays disabled.
- In production a URL whose host resolves to a private address is not called
  (`public-host.ts`); the attempt fails like any other.
- After the auto-archive sweep, reports the archived issue ids to the API
  (`/internal/webhooks/issues-archived`), which sends their Issue events.

## Invariants

- **Reads/writes `@repo/db` directly, never the API over HTTP.** It is a DB
  consumer and an HTTP producer. It does not import `apps/api`.
- **No migrations here.** The api applies them on startup; the worker only uses
  existing tables and tolerates their brief absence (a tick logs and retries).
- **At-least-once delivery.** Duplicates are possible (a 2xx whose ACK is lost);
  the `event_id` is stable across retries so receivers deduplicate. Never mint a
  new id per attempt.
- **Claim leases, not a status flag.** Claiming pushes `next_attempt_at` forward
  by `WEBHOOK_LEASE_SECONDS`; a crashed delivery is reclaimed after the lease. Keep
  the lease comfortably larger than `WEBHOOK_TIMEOUT_MS`.
- **Pure logic stays dependency-free.** `backoff.ts`, `signature.ts`, `public-host.ts`
  and `nextRetryDelayS` / `renderBody` import nothing from `@repo/db`, so unit tests run without a
  database. Keep DB access in `store.ts`.

## Config

All via env with defaults (see `src/config.ts`): `WEBHOOK_POLL_INTERVAL_MS`,
`WEBHOOK_BATCH_SIZE`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_DISABLE_THRESHOLD`, `WEBHOOK_LEASE_SECONDS`, `WEBHOOK_CLEANUP_DAYS`,
`WEBHOOK_CLEANUP_EVERY_TICKS`. Only `DATABASE_URL` is required for webhook
delivery. Agent runs, notification delivery and the auto-archive report additionally need
`WORKER_INTERNAL_TOKEN` and an api origin (`SERVICE_URL_API`, else
`API_URL`); `internal-api.ts` throws when either is missing, no fallback
origin.

## Run

- Dev: `bun run dev` at the repo root runs it under turbo alongside api + web
  (watch mode, loads root `.env`).
- Prod: the `worker` service in `docker-compose.yml`.
