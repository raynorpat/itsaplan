# Web on GraphQL — Stage 5.5: settings, members, workspace and account

Follows stages 5.1–5.4 (`docs/superpowers/specs/2026-11-23-web-graphql-stage*-design.md`).
After this stage the web makes no REST call: it talks to `/graphql` and to better-auth
(`/api/auth/*`). Project 7 then deletes the REST routes.

## Intent

Move the last REST callers in the web (about 45 methods in `apps/web/src/lib/api.ts`) to
Linear's GraphQL API, serve the three pieces of instance information that Linear's
schema has no place for through better-auth, and delete `lib/api.ts`.

## Goals

### Instance information on better-auth

- A small better-auth plugin in `packages/auth` serves, under `/api/auth/*`:
  - **sign-in options** (which methods are configured: magic link, Google, passkey),
    public, used by the login and invite pages before sign-in;
  - **the app version**, shown in the sidebar footer;
  - **upload limits** (avatar and attachment size limits and allowed types), used by
    the avatar and attachment upload screens;
  - **the team owner change** (make or remove a team owner), with the same rules as
    REST `setMemberRole` today. Linear's schema exposes `TeamMembership.owner` but no
    input that sets it, and the vendored SDL is never edited, so this one team write
    lives in the plugin (user's decision).
- The web reads them through its better-auth client. The values and who may read them
  are the same as the REST routes today (`/auth-config`, `/settings/version`,
  `/settings/storage`); those routes stay until project 7.

### Team settings

- **General:** name, description, visibility (public / private) and auto-archive
  period through `teamUpdate` (the key is read-only, as today); delete through `teamDelete`; create through
  `teamCreate`; the team list from `teams`.
- **States:** create, edit, reorder and archive through `workflowStateCreate` /
  `Update` / `Archive`; reordering writes `position`. The states import dialog uses the
  same calls. Removing a state works as in Linear (builder's call): the dialog asks for
  a state to move the state's issues to, moves them with `issueBatchUpdate`, then
  archives the state; "delete issues permanently" goes; archived states are not
  listed; the API's refusals (last state of its type) show as its message.
- **Labels and label groups:** through `issueLabelCreate` / `Update` / `Delete` (and
  retire / restore where the page offers them); a group is a label with `isGroup`, a
  label joins a group through `parentId`. The labels import dialog uses the same calls.
- **Webhooks:** per team and for all public teams (`allPublicTeams`) through
  `webhooks` / `webhookCreate` / `webhookUpdate` / `webhookDelete` /
  `webhookRotateSecret`.

### Members

- **Team members:** list from `team.memberships`; add and remove through
  `teamMembershipCreate` / `Delete`; the owner flag through the better-auth plugin
  above; joining a public team is
  `teamMembershipCreate` for the viewer.
- **Workspace users:** list from `users`; change role through `userChangeRole`;
  suspend / unsuspend through `userSuspend` / `userUnsuspend`.
- **Invites:** list, create, delete through `organizationInvites` /
  `organizationInviteCreate` / `organizationInviteDelete`; the invite page reads the
  invite through `organizationInviteDetails` (works before sign-in). The invite's
  link token and team ids go in `OrganizationInvite.metadata` (the token only for the
  sender and admins, as REST shows it today), so the list keeps "Copy link" and team
  names and the sender can copy the link right after inviting; the invite page keeps
  its teams line through the details payload's existing fields if it has a fitting
  one, otherwise it drops that line (builder's call; no SDL edit).

### Workspace and account

- Organization settings through `organization` / `organizationUpdate`.
- Notification preferences through `userSettings` / `userSettingsUpdate`
  (`notificationCategoryPreferences` and the channel preferences the page shows).
- Account timezone through `userUpdate` (`timezone`).
- Avatar upload and removal through `fileUpload` plus `userUpdate` (`avatarUrl`, null
  clears it), replacing REST `/me/avatar` (builder's call).

### Search and cleanup

- Issue search (the issue picker, the command palette and any search box that uses
  it) through `searchIssues`, with `includeArchived` where today's search returns
  archived issues. The API's `searchIssues` gains matching a bare number ("42") or an
  identifier ("KEY-42"), as Linear's search does and REST does today (builder's call).
- `lib/api.ts` is deleted. Its types that are still needed move to the services that
  use them. No web code calls a REST route. API keys stay on better-auth's client.

## Non-goals

- Deleting REST routes, MCP on GraphQL (project 7), OAuth and agents (project 6). The
  API docs page (REST OpenAPI document) and the MCP address stay until project 7.
- New settings that the pages do not have today.

## Anti-goals

- A control offered to someone the API refuses (project 2 and 3 rules: team management,
  workspace roles, organization `securitySettings`).
- Losing anything a settings, members, workspace or account page shows or does today.
- Instance information reaching someone who cannot read it today.

## Approaches

1. **GraphQL for everything Linear has; a better-auth plugin for the three instance
   values (chosen).** One data API plus the auth API, and REST can be removed in full.
2. **A small public `/instance` route kept after project 7.** Rejected: a third API
   surface to maintain.
3. **Drop the version and upload limits from the web.** Rejected: the sidebar version
   and early upload size errors are useful, and sign-in options still need a home.

## Left to the builder

The plugin's endpoint paths and response shapes, the order of the work, how the pages'
services are split, and how reorder writes `position` values.
