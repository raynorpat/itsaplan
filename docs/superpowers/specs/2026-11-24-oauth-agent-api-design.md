# Project 6: OAuth and Linear's agent API

Part of the Linear-only roadmap (projects 1–7). Projects 1–5 made `/graphql` the web's
only data API. This project adds Linear's OAuth and Linear's agent API, so that
integrations and agents connect to this app the way they connect to Linear, and so
that MCP clients sign in without pasting an API key.

## Intent

Two kinds of client need OAuth:

- **A. Integrations and agents written against Linear** (`@linear/sdk` or plain GraphQL
  with a configurable base URL). An admin registers an OAuth application; a user
  authorizes it; installed with `actor=app`, it gets its own app user that issues can
  be delegated to and that can be @-mentioned. Linear's agent API (agent sessions and
  activities) is built on this.
- **B. MCP clients** (Claude Code, Claude.ai, Cursor and others) following the MCP
  authorization spec: discovery, dynamic client registration, browser consent, as
  Linear's own MCP server does.

Hosted third-party agents that hard-code `linear.app` / `api.linear.app` cannot be
pointed at a self-hosted server; they are out of reach and not a goal.

## Stage 6.1: OAuth server, OAuth applications, MCP sign-in

### OAuth server

- Built on better-auth's OAuth provider plugin (user's choice of approach 1), in its
  current form `@better-auth/oauth-provider` (the 1.6 line, matching the installed
  better-auth). The older `oidc-provider` and `mcp` plugins are deprecated and lack
  revocation, `client_credentials` and hashed secrets, so they are not used. The
  plugin provides authorization code with PKCE, refresh tokens, revocation,
  introspection, `client_credentials`, a consent step with remembered consent, client
  management endpoints, hashed client secrets and stored tokens, and discovery
  documents (`/.well-known/oauth-authorization-server`, and
  `/.well-known/oauth-protected-resource` for the MCP resource).
- Refresh tokens are issued without `offline_access` (Linear clients never send it),
  and a refresh revokes the previous tokens.
- Dynamic client registration is open only for MCP clients (B), with
  `clientRegistrationAllowedScopes` limited to `read`, `write`, `issues:create`,
  `comments:create` and default scopes `read,write`. Self-registered clients cannot
  use `actor=app` or the `admin` and `app:*` scopes, are not listed among the admins'
  OAuth applications, and are listed among a user's authorized apps once used
  (builder's call). OAuth applications for A are created by admins (below).
- The `client_credentials` grant is supported for installed `actor=app` applications;
  it issues a token acting as the app user, as Linear's does (builder's call).
- Linear's endpoint paths are served and forward to the plugin: `/oauth/authorize`,
  `/oauth/token`, `/oauth/revoke`, with Linear's parameters (`client_id`,
  `redirect_uri`, `response_type=code`, `scope` comma-separated as Linear accepts it,
  `state`, `actor`, `prompt=consent`, PKCE). An app written for Linear changes only
  its base URLs.
- Tokens are accepted on `/graphql` and `/mcp` as `Authorization: Bearer <token>`,
  alongside API keys and session cookies.

### Scopes

- Linear's scopes: `read`, `write`, `issues:create`, `comments:create`, `admin`,
  `app:assignable`, `app:mentionable` (`timeSchedule:write` is not supported; there is
  no such feature). Linear's paths accept comma-separated scopes and pass them on
  space-separated.
- Every GraphQL operation checks the token's scopes the way Linear does: queries need
  `read`; mutations need `write`, except issue creation (`issues:create`) and comment
  creation (`comments:create`) which accept their narrow scope; admin-only operations
  need `admin` in addition to the user's own rights. A token never grants more than
  the user (or app user) it acts for.
- MCP tools run REST routes in process until project 7, so the rule there is: a
  read-only tool needs `read`; a tool that writes needs `write`, except creating an
  issue (`issues:create`) and a comment (`comments:create`); admin tools need
  `admin`. MCP dispatch carries the token's user and scopes (builder's call).

### Consent screen

- A web page at the authorize step: the app's name, icon and developer, the scopes in
  plain words, whether it installs as an app (`actor=app`), the workspace, Allow and
  Deny. Remembered consent skips the page unless `prompt=consent`.

### OAuth applications

- Settings → API → OAuth applications (admins): create, edit (name, description,
  developer, developer URL, icon, redirect URIs, webhook URL and resource types, and
  whether it is a public client — no secret, PKCE required), rotate the client secret,
  rotate the webhook secret, archive. Linear's `oauthApplication*` GraphQL operations
  are documented in the SDL as operations an OAuth application performs on
  applications it created, not as admin management, so the web manages applications
  through the OAuth provider plugin's client endpoints and the instance plugin under
  `/api/auth/*`, as stage 5.5 did for the team owner change; the GraphQL
  `oauthApplication*` operations are not implemented in this project (builder's call).
- Webhooks of an OAuth application are delivered by the existing webhook worker with
  the app's secret, for the resource types it subscribes to, in the workspaces it is
  installed in (one workspace here).
- Each user sees the applications they have authorized (account settings) and can
  revoke one; admins see the workspace's installed apps and can uninstall one. Both
  go through the plugin's consent and token endpoints under `/api/auth/*`.
- An application's webhook delivers events for the teams its app user can access when
  installed with `actor=app`, and for public teams otherwise; the webhook table gains
  an owner for application webhooks (builder's call).

### `actor=app` and app users

- Installing with `actor=app` is admin-only (Linear). It creates one app user per
  application: `User.app = true`, the app's name and icon, cannot sign in, is not
  counted as a member, and is not a seat. Tokens issued for an `actor=app`
  authorization act as that app user.
- The app user appears in the assignee / delegate pickers if the installation granted
  `app:assignable`, and in @-mention suggestions if it granted `app:mentionable`.
- Comments, history and activity written with an app token show the app user (name and
  icon). Writes made with a user token (`actor=user`) show the user only; recording the
  app on every written entity ("User via App") and the `createAsUser` /
  `displayIconUrl` inputs are not supported in this project (builder's call).
- Uninstalling revokes the app's tokens and deactivates the app user; its past
  comments and history stay.
- Team access of an app user, as in Linear: the installing admin selects teams at
  install time (default: all public teams). The app user gets its own workspace role,
  `app`, which sees and works only in its selected teams (stored as team membership
  rows marked as app memberships, hidden from team member lists and counts); projects,
  documents and initiatives are visible to it through those teams. An app user never
  has admin rights, so the `admin` scope has no effect for `actor=app` tokens
  (builder's call).

### MCP

- `/mcp` accepts OAuth tokens as well as API keys (as Linear's MCP server does). An MCP
  client registers itself, sends the user through consent, and then calls tools with
  the token; tools act as that user with the token's scopes.

## Stage 6.2: the agent API

- **Delegation:** `issue.delegateId` (and `delegate` in `issueUpdate` / `issueCreate` /
  `issueBatchUpdate`) accepts app users with `app:assignable`; the assignee stays the
  responsible person, as in Linear.
- **Sessions:** delegating an issue to an app user, or @-mentioning it in a comment,
  creates an `AgentSession` (status `pending`) and sends an `AgentSessionEvent`
  webhook (`action: created`) to the app with the issue, comment and previous
  activities as Linear's payload carries them. `agentSessionCreateOnIssue` and
  `agentSessionCreateOnComment` start one by hand (the app's own token).
- **Activities:** `agentActivityCreate` with Linear's content types `thought`,
  `action`, `elicitation`, `response`, `error`, and `prompt` (written by people); the
  session status moves as Linear's does (`active` on the first activity,
  `awaitingInput` on an elicitation, `complete` on a response, `error` on an error).
  A person's reply in the session thread becomes a `prompt` activity and sends an
  `AgentSessionEvent` (`action: prompted`). `agentSessionUpdate` and
  `agentSessionUpdateExternalUrl` set the external link and plan as Linear's input
  allows.
- **Response time:** Linear expects the agent to answer a new session within a short
  time (an activity or `thought`) and marks unresponsive sessions; follow Linear's
  rule where the SDL or docs state it, otherwise sessions stay `pending` until the
  agent writes (builder's call).
- **Notifications:** `AgentSessionNotification` for the person who started a session
  when it needs input or completes.
- **Web:** a Delegate field on the issue page (app users with `app:assignable`); the
  session's activities shown in the issue's activity feed in Linear's style (thoughts
  and actions collapsed, responses and elicitations as messages); the session status
  on the issue; replying in the session thread sends a prompt (`commentCreate`);
  stopping a session writes a `prompt` activity with Linear's `stop` signal and sends
  an `AgentSessionEvent` (`action: prompted`). The SDL does not let an API client
  publish the stop signal, so the web's Stop goes through the instance plugin under
  `/api/auth/*` (builder's call).
- `AgentSkill` and its mutations are not part of this project.

## Who can do what

- Creating, editing and archiving OAuth applications: admins and owners.
- Installing with `actor=app`: admins and owners.
- Authorizing an app to act as yourself: any user, guests included; a token never
  exceeds the rights of the user it acts for (builder's call).
- Seeing agent sessions and activities: anyone who can see the issue.

## Non-goals

- Hosted Linear agents that hard-code Linear's hostnames.
- `AgentSkill`, app marketplaces, multi-workspace installs.
- Moving MCP tools to GraphQL and deleting REST (project 7).

## Anti-goals

- A token that grants more than the user or app user it acts for.
- Cookie-authenticated POSTs to the consent step or the instance plugin without the
  Origin check stage 5.5 added.
- An app user that can sign in, counts as a member, or appears where an app should not
  (pickers without the matching scope).
- Secrets (client secrets, webhook secrets, tokens) shown again after creation, logged,
  or sent anywhere but to their owner.
- An OAuth flow that accepts an unregistered redirect URI or skips PKCE for public
  clients.

## Approaches

1. **better-auth's OAuth provider plugin (`@better-auth/oauth-provider`), with
   Linear's paths, scopes and `actor=app` added (chosen).** Token handling, PKCE,
   revocation, `client_credentials`, discovery and dynamic registration are maintained
   upstream and sit where sign-in already is; `actor=app`, Linear's comma scopes and
   the app user are added around it.
2. **Our own OAuth server in the API.** Exact Linear behaviour, but we would write and
   test the security-critical token code ourselves.
3. **A separate identity service.** Rejected: another service for every self-hoster.

## Left to the builder

Table layout beyond the plugins' own tables, how Linear's paths forward to the plugin,
token lifetimes (follow Linear's where documented), the consent page layout, and the
order of the work inside each stage.
