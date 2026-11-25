# GraphQL API

It's a Plan serves **Linear's published GraphQL schema** at `<API_URL>/graphql`. Tools built
for Linear, including the official [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk),
work against your instance by pointing them at your API address. GraphQL is the only data
API; there is no REST API.

This page covers authentication, a first request, what is implemented, and how the API
behaves where it differs from linear.app. The schema itself, with every type and field
documented, is vendored unmodified at
[`apps/api/src/graphql/schema.graphql`](../apps/api/src/graphql/schema.graphql).

## Authenticate

Every request needs a credential. Pick one:

| Credential          | Where you get it                                              | Send it as                              | Acts as                                  |
| ------------------- | ------------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| Personal API key    | Settings → Account → API keys                                 | `Authorization: <key>` (or `Bearer <key>`) | you, with your full rights            |
| OAuth access token  | an OAuth application's authorization flow (below)             | `Authorization: Bearer <token>`         | the user who authorized, within scopes   |
| Session cookie      | signing in to the web app                                     | the cookie                              | you (used by the web app)                |
| Release access key  | team settings → Releases → a pipeline's access keys           | `Authorization: Bearer itpr_…`          | that pipeline only, for CI release sync  |

A request without valid credentials gets HTTP 401 with `extensions.code:
"AUTHENTICATION_ERROR"`. The one exception is `organizationInviteDetails`, which the invite
page calls before the invitee has an account.

## Make a request

With `curl`:

```bash
curl https://api.example.com/graphql \
  -H "Authorization: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { id name } teams { nodes { id key name } } }"}'
```

With the Linear SDK:

```ts
import { LinearClient } from '@linear/sdk';

const linear = new LinearClient({
  apiKey: process.env.ITSAPLAN_API_KEY,
  apiUrl: 'https://api.example.com/graphql',
});

const me = await linear.viewer;
const issues = await linear.issues({
  first: 50,
  filter: { state: { type: { eq: 'started' } } },
  sort: [{ priority: { order: 'Ascending' } }],
});
console.log(me.name, issues.nodes.map((i) => i.identifier));
```

## OAuth applications

Owners and admins create OAuth applications under Settings → Workspace → Applications. The
flow follows Linear's paths and parameters on your API origin:

| Step       | Endpoint                          |
| ---------- | --------------------------------- |
| Authorize  | `GET <API_URL>/oauth/authorize`   |
| Token      | `POST <API_URL>/oauth/token`      |
| Revoke     | `POST <API_URL>/oauth/revoke`     |
| Register   | `POST <API_URL>/oauth/register` (dynamic client registration, used by MCP clients) |

Scopes:

| Scope              | Allows                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| `read`             | queries; granted with every token                                        |
| `write`            | mutations                                                                |
| `issues:create`    | `issueCreate` and `attachmentCreate` without `write`                     |
| `comments:create`  | `commentCreate` without `write`                                          |
| `admin`            | admin operations, when the authorizing user is an owner or admin        |
| `app:assignable`   | with `actor=app`: the app can be delegated issues                        |
| `app:mentionable`  | with `actor=app`: the app can be @-mentioned                             |

With `actor=app`, the install creates an app user that acts in its own name. This is how
agents use Linear's agent API (`AgentSession`, `agentActivityCreate`, delegation).

Each user sees the applications they authorized under Settings → Account → Authorized apps.

## Pagination, filtering and sorting

- **Connections** follow Linear: `first` / `after` and `last` / `before`, with `nodes`,
  `edges` and `pageInfo`. Pages default to 50 items and allow at most 250. Without a sort,
  lists are newest first; `orderBy: updatedAt` orders by last update instead.
- **Filters** take Linear's filter inputs (`IssueFilter`, `ProjectFilter`, …). A filter field
  the instance does not support is refused with `INVALID_INPUT`, never ignored.
- **Sorting** takes Linear's `sort` arguments on every list that has one in the schema
  (issues, projects, initiatives, users, documents, custom views, releases, release
  pipelines; customers take `sorts`). Several keys apply in order, each with `order` and
  `nulls`. A sorted list pages forward only: `last` / `before` with `sort` is
  `INVALID_INPUT`. Text sorts ignore case.

## Errors

Errors carry Linear's codes in `extensions.code`:

| Code                   | Meaning                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `AUTHENTICATION_ERROR` | no valid credentials (HTTP 401)                                      |
| `FORBIDDEN`            | signed in, but your role or token scope does not allow it           |
| `ENTITY_NOT_FOUND`     | the item does not exist or you cannot see it (hidden items look missing) |
| `INVALID_INPUT`        | the input breaks a rule; the message says which                      |
| `CONFLICT`             | a duplicate or a concurrent change                                   |
| `NOT_IMPLEMENTED`      | a root query or mutation of Linear's schema this instance does not serve |

## What is implemented

The instance serves **92 of Linear's 159 queries and 166 of its 336 mutations**. Every field
of a type that is served has a value: a field without its own resolver reads the parent's
property or a neutral value (`null`, an empty list, `0`). Only root queries and mutations
answer `NOT_IMPLEMENTED`.

Served areas: issues (with history, relations, sub-issues, subscriptions, attachments,
templates, estimates, batch updates), teams and memberships, workflow states, labels,
users and roles, workspace settings and invites, comments and reactions, documents,
projects (statuses, milestones, updates, labels, members, relations, progress), cycles,
initiatives, custom views and view preferences, favorites, notifications, webhooks, file
uploads, issue imports (GitHub, Jira CSV), feedback (`customerNeed*`), customers, releases
and release notes, the agent API, search (`searchIssues`), and the audit log.

[Linear compared with It's a Plan](linear-comparison.md) lists what is missing by area.

## Webhooks

Webhooks use Linear's payload format and subscription model, so a Linear webhook receiver
works unchanged. Create them per team (team settings → Webhooks) or for all teams through
`webhookCreate`.

Each delivery is a `POST` with these headers:

| Header             | Value                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| `Linear-Signature` | hex HMAC-SHA256 of the raw body, keyed with the webhook's secret                     |
| `Linear-Event`     | the resource type, for example `Issue`                                               |
| `Linear-Delivery`  | the delivery id, the same across retries so you can deduplicate                      |
| `Linear-Timestamp` | the send time, Unix milliseconds                                                                        |

The body includes `webhookTimestamp` (Unix milliseconds). Verify the signature over the
exact bytes you received, then reject deliveries whose timestamp is more than a minute old.

Only HTTP 200 counts as delivered. Any other status, a network error or a 5-second timeout
fails the attempt; it is retried after 1 minute, 1 hour and 6 hours, then marked failed. A
webhook is disabled after 20 deliveries in a row fail after all retries
(`WEBHOOK_DISABLE_THRESHOLD`).
Delivery is at least once, so deduplicate on `Linear-Delivery`. In production, URLs that
resolve to private addresses are not called.

Resource types: `Issue`, `Comment`, `IssueLabel`, `Project`, `ProjectUpdate`, `Reaction`,
`Cycle`, `Initiative`, `InitiativeUpdate`, `Document`, `Attachment`, `CustomerNeed`,
`Customer`.

## MCP

The instance serves Linear's MCP tool set over HTTP at `<API_URL>/mcp`, and the read-only
tools at `<API_URL>/mcp/readonly`. Connect with an API key (`Authorization: Bearer <key>`)
or let the MCP client sign in through OAuth: a 401 carries `WWW-Authenticate` with the
protected-resource metadata URL (RFC 9728), which names the authorization server. Each tool runs GraphQL as the
caller, so access and scopes are the same as for GraphQL.

## Features outside Linear's schema

Some features have no place in Linear's schema. The web app manages them through the
API's instance endpoints under `<API_URL>/api/auth/instance/*` (the session cookie, or an
API key as `x-api-key: <key>`; a `POST` with the session cookie needs an `Origin` the
instance trusts):

| Area                        | Endpoints                                         |
| --------------------------- | ------------------------------------------------- |
| Dashboards                  | `/instance/dashboard*`                           |
| Requesters (feedback people) | `/instance/requester*`, `/instance/feedback/*`  |
| Client portal boards        | `/instance/portal/*`                              |
| Intake forms                | `/instance/forms*`                                |
| Customers settings          | `/instance/customers-settings*`                   |
| AI endpoint for summaries   | `/instance/ai*`                                   |
| Workflow automations        | `/instance/workflow*`                            |
| Issue imports (GitLab, Gitea, Forgejo, CSV) | `/instance/import*` |
| Release access keys         | `/instance/access-keys*`                          |
| Audit log settings and export | `/instance/audit*`                              |

These endpoints are for the web app and are not a stable public API. The full list, with
who may call each, is in [`packages/auth/AGENTS.md`](../packages/auth/AGENTS.md).

## See also

- [Release sync from CI](release-sync.md): `releaseSyncByAccessKey` from a CI job
- [Linear compared with It's a Plan](linear-comparison.md)
- Linear's own API documentation: <https://linear.app/developers>
