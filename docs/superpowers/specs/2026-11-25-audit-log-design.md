# Audit log

## Intent

Owners need to investigate what happened after the fact and answer client security
questionnaires ("Do you keep an audit log of administrative actions and sign-ins? How
long?"). Linear keeps a workspace audit log (Settings → Security → Audit log, and the
`auditEntries` API). This adds one: a complete, append-only record of security-relevant
actions with who did them, from where and how they were authenticated.

## Goals

### Entries (Linear's `AuditEntry`)

- An entry has `type` (an action identifier), the actor (`actor` / `actorId`, null for
  an unauthenticated attempt or a system action), `createdAt`, `ip`, `countryCode`,
  `metadata` (the affected resources' ids and names and what changed, never secrets,
  tokens, passwords or issue content), and `requestInformation` (user agent, the
  authentication method — `session`, `apiKey`, `oauth` with the application's id and
  name, `accessKey` with the pipeline, `worker`, `system` — and the route or GraphQL
  operation name).
- The IP is the connection's address, or `X-Forwarded-For` / `X-Real-IP` only when
  `TRUST_PROXY=true` (the portal's existing rule). `countryCode` is read from
  `CF-IPCountry` (or a configurable trusted header) only when `TRUST_PROXY=true`, else
  null (builder's call: no geo-IP database is bundled).
- **Append-only:** no API, endpoint or UI edits or deletes an entry, owners included.
  Only the retention clean-up removes entries.
- An entry is written in the same transaction as the action when the action has one,
  so the action and its entry succeed or fail together. Actions outside a transaction
  (sign-ins, sign-outs, passkey and API key changes in better-auth, exports) write their
  entry directly, and **if that write fails the action still goes ahead** (user's
  choice): the failure is logged on the server (`[audit] entry not written`) and the
  next entry written records `{ missedEntries: n }` in its metadata, counted in
  memory per process (builder's call). A missing header is null, never an error.
- **Repeated failed sign-ins** from the same attempted address and IP within 10 minutes
  are one `loginFailed` entry whose `metadata.attempts` counts them (builder's call: an
  outsider cannot flood the log).

### What is recorded (types; `auditEntryTypes` lists each with a description)

- **Sign-in and account:** `login` (with method: magic link, Google, passkey),
  `loginFailed` (unknown address, bad passkey, refused domain, suspended user; the
  attempted address in metadata), `logout`, `sessionRevoked`, `passkeyAdded` /
  `passkeyRemoved`, `emailAdded` / `emailConfirmed` / `emailRemoved`,
  `apiKeyCreated` / `apiKeyDeleted`.
- **People and roles:** `inviteCreated` / `inviteRevoked` / `inviteAccepted`,
  `userRoleChanged`, `userSuspended` / `userUnsuspended`, `ownerAdded` / `ownerRemoved`,
  `teamMemberAdded` / `teamMemberRemoved`, `teamOwnerChanged`.
- **Teams:** `teamCreated`, `teamDeleted`, `teamVisibilityChanged`.
- **Integrations and keys:** `oauthAppCreated` / `oauthAppUpdated` / `oauthAppDeleted`
  / `oauthAppSecretRotated`, `oauthAuthorized` / `oauthRevoked` / `appInstalled` /
  `appUninstalled`, `webhookCreated` / `webhookUpdated` / `webhookDeleted`,
  `releaseAccessKeyCreated` / `releaseAccessKeyRevoked`, `aiSettingsChanged`.
- **Workspace settings:** `organizationUpdated` (name, URL key, logo),
  `securitySettingsChanged` (minimum roles, allowed sign-in services, upload types),
  `customersSettingsChanged`, `auditRetentionChanged`.
- **Exports:** `dataExported` (what was exported: the audit log with its filters, a
  dashboard or a widget's CSV, and the row count). The audit export is produced by the
  API; the web's dashboard CSV downloads report themselves through an instance endpoint
  before the file is saved (builder's call).
- **Data:** `importStarted` / `importCompleted` / `importFailed`, `teamDeleted` (above),
  `projectDeleted`, `projectPurged` (worker), `issueDeleted`, `dashboardDeleted`,
  `customerDeleted` / `customerMerged`, `requesterMerged`, `portalBoardCreated` /
  `portalBoardUpdated` / `portalBoardDeleted`, `requesterBlocked` /
  `requesterUnblocked`, `formSettingsChanged`.
- Changes to issue fields, comments and other everyday work are not recorded here;
  issue and project history already keeps them.

### Reading and exporting

- **Settings → Security → Audit log** (owners and admins): newest first, filters by
  type, person, date range and IP, and **Export CSV** of the filtered entries (RFC 4180,
  the formula guard the dashboards use; at most 100,000 rows per export, builder's call).
- GraphQL: `auditEntries` (Linear's `AuditEntryFilter`, connection paging, owners and
  admins; an OAuth token needs the `admin` scope), `auditEntryTypes`. Everyone else gets
  FORBIDDEN.

### Retention

- Owners choose how long entries are kept: 90 days, 1 year (default), 2 years, 3 years
  or forever (through `/api/auth/instance/audit-settings`; Linear's schema has no field
  for it). The worker deletes older entries daily. Changing the period is itself
  recorded.

## Non-goals

- Streaming entries to an external system (SIEM, webhook), alerting on suspicious
  activity, recording reads (who viewed what), per-issue field history (already exists),
  portal visitor actions (they have their own records).

## Anti-goals

- An entry that holds a secret (a key, token, password, magic link) or issue content.
- An entry anyone can edit or delete.
- An action that fails because recording it failed to gather request details.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations.
  Follow the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.

## Approaches

1. **Record each action where it happens (chosen by the user).** One `recordAudit`
   call per action, request details from the request context.
2. Database triggers. Rejected: no actor, IP or authentication method, and sign-ins are
   not table writes.
3. Log every mutation automatically. Rejected: misses better-auth sign-ins, records
   content, and gives no clear action names.

## Left to the builder

The table shape and indexes, the request-context plumbing (extending the existing
request-auth context), the exact metadata keys per type, the page layout within
DESIGN.md, and the order of the work.
