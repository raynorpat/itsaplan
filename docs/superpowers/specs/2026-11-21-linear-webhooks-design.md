# Linear-format webhooks — design

Stage 2, last part. Follows the stage 1 and stage 2 designs
(`2026-11-20-linear-graphql-stage1-design.md`,
`2026-11-21-linear-graphql-stage2-projects-design.md`).

## Intent

Outgoing webhooks match Linear's, so a receiver written for Linear's webhooks works
when pointed at this instance: it verifies the signature the way Linear documents
it, and parses the same headers, envelope and entity data. Webhooks can also be
managed with `@linear/sdk` over GraphQL. Standing rule: when unsure, do what Linear
does (https://linear.app/developers/webhooks).

## Goals

- Linear's delivery format: headers, signature, envelope, `actor`, `updatedFrom`.
- Linear's subscription model: resource types, one team or all teams.
- Linear's delivery rules: 5 s timeout, 3 retries after 1 min, 1 h and 6 h.
- Events for every resource type the app has: Issue, Comment, IssueLabel, Project,
  ProjectUpdate.
- GraphQL management: `webhooks`, `webhook`, `webhookCreate`, `webhookUpdate`,
  `webhookDelete`, `webhookRotateSecret`.
- REST and the web settings page keep working with the new model.

## Non-goals

- Issue SLA and OAuthApp-revoked events (no SLA or OAuth apps here).
- Resource types with no feature behind them (Cycle, Reaction, Document,
  Initiative, Customer, Attachment, User). `webhookCreate` rejects them with
  INVALID_INPUT naming the type.
- Source-IP allowlists, HTTPS-only URLs (self-hosted instances post to internal
  hosts; the existing URL validation stays).
- `Webhook.failures` beyond what the delivery history already stores.

## Anti-goals

- A receiver that verifies Linear signatures fails on our deliveries.
- A webhook leaks data of a team its scope does not cover.
- Two formats in parallel. The current format (`X-Itsaplan-*` headers, granular
  event names such as `issue.state_changed`, timestamped signature) is removed;
  nothing outside this repo reads it.

## Approach

Considered:

1. **Build the full Linear payload at emit time, keep the delivery queue
   (chosen).** The API already queues one `webhook_delivery` row per matching
   webhook where the change happens. It has the entity before and after the change,
   so it can compute `updatedFrom` and `actor` there, and it formats `data` with the
   GraphQL mappers. The worker keeps claim, lease, cleanup and auto-disable, and
   changes only headers, signature and retry schedule.
2. **Worker builds the payload at delivery time from an entity id.** Rejected: the
   worker cannot import the API's GraphQL mappers, so they would be duplicated, and
   the payload would show the entity at delivery time, which breaks `updatedFrom`.
3. **Emit only from GraphQL mutations.** Rejected: changes from the web app, REST
   and MCP would send nothing.

## Data model

`webhook` (the baseline migration is regenerated; there is no data to keep):

| column                 | notes                                                        |
| ---------------------- | ------------------------------------------------------------ |
| `id`                   | uuid                                                         |
| `team_id`              | nullable; null when `all_public_teams`                        |
| `all_public_teams`     | boolean, default false                                       |
| `url`                  | text                                                         |
| `label`                | text, nullable                                               |
| `secret`               | text                                                         |
| `resource_types`       | jsonb array of `Issue` `Comment` `IssueLabel` `Project` `ProjectUpdate` |
| `enabled`              | boolean, default true (renamed from `is_active`)             |
| `creator_user_id`      | nullable FK to user, set null on delete                      |
| `consecutive_failures` | as today                                                     |
| `created_at`, `updated_at` |                                                          |

Check constraint: exactly one of `team_id` set or `all_public_teams` true.
`webhook_delivery` keeps its shape; `event_type` holds the resource type
(`Issue`, …) and `event_id` is sent as `Linear-Delivery`.

## Scope and access

- **Team webhook:** receives events of that team. Managed with the team's
  `webhooks.<action>` permission (the existing permission matrix; owners hold it).
- **All-teams webhook** (`allPublicTeams: true`): receives events of every team,
  including teams created later. All teams count as public (GraphQL already reports
  `Team.private = false`). Created, read, changed and deleted only by the god user
  or by a user who is owner of every team. The rule is checked on every operation,
  so someone who stops owning a team loses access until they own all teams again.
- **Which webhooks receive an event:**
  - Issue, Comment, IssueLabel (team label): webhooks of the issue's / label's team,
    plus all-teams webhooks.
  - Project, ProjectUpdate: webhooks of every team the project includes, plus
    all-teams webhooks. One delivery per webhook even when it matches through
    several teams.
  - A Project `update` that changes the teams goes to the webhooks of the teams
    before and after the change (the union), so a removed team's receiver learns
    the project left it. A `remove` uses the teams the project had. *(Builder
    check; decided.)*
- A webhook that subscribes to a type never receives an event outside its scope.

## Delivery format

Headers:

- `Content-Type: application/json; charset=utf-8`
- `User-Agent: Linear-Webhook`
- `Linear-Delivery`: the delivery's event id (uuid, stable across retries)
- `Linear-Event`: the resource type (`Issue`, `Comment`, …)
- `Linear-Timestamp`: send time, Unix ms
- `Linear-Signature`: hex HMAC-SHA256 of the raw body, keyed with the webhook secret

Body:

```json
{
  "action": "create | update | remove",
  "type": "Issue",
  "actor": { "id": "…", "type": "user", "name": "…", "email": "…", "url": "…" },
  "createdAt": "ISO time of the change",
  "data": { "…": "the entity" },
  "updatedFrom": { "field": "previous value" },
  "url": "web URL of the entity",
  "organizationId": "fixed workspace id",
  "webhookTimestamp": 1732190000000,
  "webhookId": "…"
}
```

- `webhookTimestamp` is set at send time (worker), so the receiver's one-minute
  replay check passes on retries. The worker sets it into the stored payload before
  signing.
- `actor` is the acting user (agents are users of kind agent; their `type` is
  `"user"` too). Null when the change has no user (worker jobs such as auto-archive).
  `url` is the user's web profile URL when one exists, else omitted.
- `updatedFrom` is present on `update` only: the previous values of the changed
  fields, keyed like `data`, with `updatedAt` always included (Linear does this).
  A previously unset value is `null`.
- `data` is the entity as the GraphQL mapper for that type returns it, flattened
  with the relation ids Linear puts in webhook data (Issue: `teamId`, `stateId`,
  `assigneeId`, `labelIds`, `projectId`, `projectMilestoneId`, `parentId`,
  `creatorId`; Comment: `issueId`, `userId`; Project: `teamIds`, `statusId`,
  `leadId`; ProjectUpdate: `projectId`, `userId`; IssueLabel: `teamId`, `parentId`).
  Issue data also carries small nested objects for `team`, `state`, `assignee`
  and `labels` (`id`, `name`, plus `key`/`color`/`type` where the mapper has them),
  as Linear's does.
- `remove` sends the entity as it was before deletion.
- `url` is the web app URL of the entity (`APP_URL` first entry + the web path).
  `organizationId` is the instance's organization id that GraphQL already stores
  and returns (`graphql/resolvers/organization.ts`); webhooks reuse it.
- Comment and team IssueLabel have no GraphQL mapper yet. This part adds
  `toComment` and `toIssueLabel` mappers shaped like Linear's `Comment` and
  `IssueLabel` types, in `graphql/resolvers/`, so the later GraphQL stage for
  comments and labels reuses them. *(Builder check; decided.)*

## Events

| type          | create                 | update                                  | remove          |
| ------------- | ---------------------- | --------------------------------------- | --------------- |
| Issue         | issue created          | any field change, incl. labels, archive | issue deleted   |
| Comment       | comment created        | — (comments cannot be edited)           | —               |
| IssueLabel    | team label created     | renamed / recolored / regrouped         | label deleted   |
| Project       | project created        | any field change, incl. teams, archive  | project deleted |
| ProjectUpdate | update posted          | update edited                           | update deleted  |

A bulk issue update sends one event per issue.

Label groups are IssueLabels, as in Linear: a team label group (`label_group`)
is sent as an IssueLabel with `isGroup: true`, and a grouped label's `parentId`
is its group's id. Creating, renaming and deleting a group send IssueLabel
events. Deleting a group ungroups its labels, and each of those labels sends an
`update` with `parentId` in `updatedFrom`. *(Builder check; decided.)*

Changes made by the worker send events too. Auto-archive (`archiveStaleIssues`
in the worker) reports the archived issue ids to a new `/internal/*` API route
through the worker's existing `postInternal` client, and the API sends an Issue
`update` per issue with `actor: null`. The builder confirms no other worker job
writes issues, comments, labels or projects directly; any that does gets the same
treatment. *(Builder check; decided.)* Issue label changes are an Issue
`update` with `labelIds` in `updatedFrom`. Deleting a team does not send events for
the issues and projects removed with it (Linear sends none for cascaded deletes).

## Delivery rules (worker)

- Timeout 5000 ms. Only HTTP 200 counts as success (Linear); any other status,
  network error or timeout is a failure.
- Retries: 3, after 1 minute, 1 hour and 6 hours (no jitter needed), then the
  delivery is `failed`. These replace `WEBHOOK_MAX_ATTEMPTS` and the backoff
  formula; the timeout default changes to 5000.
- Auto-disable after `WEBHOOK_DISABLE_THRESHOLD` consecutive failed deliveries
  stays (sets `enabled = false`); re-enabling is manual.
- Claim/lease/cleanup unchanged.

## Management surfaces

- **GraphQL:** `webhooks` (connection; team webhooks the viewer can read plus
  all-teams webhooks when the viewer qualifies), `webhook(id)`, `Team.webhooks`,
  `webhookCreate` (input `url`, `resourceTypes`, `teamId` or `allPublicTeams`,
  `label`, `secret`, `enabled`; a missing secret is generated), `webhookUpdate`
  (`url`, `label`, `resourceTypes`, `secret`, `enabled`), `webhookDelete`,
  `webhookRotateSecret`. `Webhook` fields: id, url, label, enabled, secret,
  resourceTypes, team, allPublicTeams, creator, createdAt, updatedAt; `failures`
  returns the recent failed deliveries mapped to `WebhookFailureEvent` where it
  fits, else an empty list. Unsupported input fields → INVALID_INPUT naming the
  field, as elsewhere.
- **REST:** team routes stay (`/teams/:teamKey/webhooks`, `/webhooks/:id`,
  deliveries), with `resourceTypes`, `label`, `enabled` replacing `events` /
  `isActive`. All-teams webhooks: `GET/POST /webhooks` (workspace level), access as
  above. MCP tools follow the routes.
- **Web:** the team webhook dialog shows resource-type checkboxes instead of event
  names, a label field, and an "All teams" switch shown only to the god user or an
  owner of every team. All-teams webhooks appear in the same list, marked "All
  teams", for users who may manage them.

## Testing

- API integration: emit for each type and action, scope matching (team, all-teams,
  multi-team project once per webhook, no leak to another team's webhook),
  `updatedFrom` contents, actor, all-teams access rule (god, owner of all, owner of
  some → 403), GraphQL management through the SDK.
- Worker: signature equals hex HMAC of the exact body; headers; 200-only success;
  retry schedule; `webhookTimestamp` refreshed per attempt; a receiver written
  against Linear's documented verification (raw-body HMAC + one-minute timestamp
  check) accepts a delivery.

## Left to the builder

- File layout inside `apps/api/src/webhooks/` and the worker.
- How `updatedFrom` is computed (diff of the mapped before/after `data`, or of the
  snapshots the stores already build).
- Exact web layout of the dialog changes.
