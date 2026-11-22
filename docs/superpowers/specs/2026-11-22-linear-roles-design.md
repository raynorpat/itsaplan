# Linear's roles and teams

Project 2 of the Linear-only app (after project 1, the removal of features Linear
does not have).

## Intent

Access follows Linear's model: workspace roles, workspace invites, public and private
teams, and team owners. Custom team roles and the permission matrix go. One access
module answers every "may this user do X here?" question, for REST now and GraphQL
throughout, so the later projects (organization settings, the web app on GraphQL,
OAuth and agents, deleting REST) build on Linear's model. Nothing has been
released; existing rows are mapped, not preserved in detail.

## Goals

- **Workspace roles** on users: `owner`, `admin`, `member`, `guest` (Linear's
  `UserRoleType`; `app` arrives with agents in project 6).
- **Team visibility:** `public` or `private` (Linear's `TeamVisibility`; `restricted`
  is not offered).
- **Team owners:** `team_member.owner`.
- **Workspace invites** with a role and optional teams, replacing team invites.
- **Public teams are open to the workspace:** owners, admins and members see and
  work in every public team without joining (Linear). Joining adds the team to
  their sidebar and team pickers; anyone but a guest may join a public team
  themselves.
- GraphQL: `User.admin` / `owner` / `guest` / `active`, `userChangeRole`,
  `userSuspend` / `userUnsuspend`, `Team.visibility` / `private`,
  `TeamMembership.owner`, `teamMembershipCreate` / `Update` / `Delete`,
  `organizationInviteCreate` / `Delete`, `organizationInvites`, `teamCreate`
  `visibility`; REST routes and web pages for the same, until the web moves to
  GraphQL in project 5.

## Non-goals

- `restricted` team visibility, team or organization `securitySettings` choices
  (who may invite, create teams, manage labels: fixed by the table below), SCIM,
  SAML, billing.
- Moving god mode settings to `Organization` (project 3): owners and admins use god
  mode until then.
- Agents and the `app` role (project 6).

## Anti-goals

- Anyone reaching a private team's issues, projects, documents, comments or
  attachments without being its member.
- A guest seeing a team, project, initiative, user or workspace label beyond the
  teams they were added to.
- Someone inviting or promoting a person above their own role.
- A workspace with no owner.
- A check left on the old matrix, or two access concepts side by side.

## Approaches

1. **Replace the access model outright (chosen).** New columns on `user`, `team`
   and `team_member`, workspace invites, one access module; `team_role` and the
   matrix removed.
2. **Keep the matrix behind role presets.** Rejected: two concepts in the code, and
   team visibility and self-join have no place in a matrix.
3. **better-auth's organization plugin.** Rejected: one workspace per instance, its
   roles and invites differ from Linear's, and its tables would need mapping.

## Model

- `user.workspace_role` text, not null, default `member`, check in (`owner`,
  `admin`, `member`, `guest`); `user.suspended_at` timestamptz, nullable (Linear's
  `active` = not suspended). The global better-auth `user.role` (`god` / `user`) is
  removed; the god user becomes an owner.
- `team.visibility` text, not null, default `public`, check in (`public`,
  `private`).
- `team_member.owner` boolean, not null, default false; `team_member.role`,
  `team_member.role_id` and `team_role` are removed.
- `workspace_invite` replaces `team_invite`: email, role (`admin`, `member`,
  `guest`), team ids, invited by, token, created, expires; one pending invite per
  email.
- Migration: god user → `owner`, every other user → `member`; team `owner` members
  → `team_member.owner = true`; every team public; pending team invites become
  workspace invites with role `member` and their team.

## Access rules

**Seeing and working in a team.** Owners, admins and members see and work in every
public team, joined or not, and in the private teams they are members of. Guests see
and work only in the teams they are members of, public or private. Joining a public
team (anyone but a guest, no invite needed) adds it to the user's sidebar and team
pickers and makes them a member for notifications and "my teams" lists. Admins and
owners also see that private teams exist in team settings and may add themselves;
the content stays hidden until they join. GraphQL `teams`, `team(id)` and
`Organization.teams` follow this rule ("public teams plus private teams the user is
a member of"; guests: their teams).

**Everything else follows the team:** issues, comments, attachments, documents,
relations, cycles, views, reactions and notifications follow the issue's team; a
project or initiative is visible through any team of it the user can see (as now,
with "team grants projects.read" becoming "can see the team"). One helper gives the
SQL set of teams a user can see (`visibleTeamIds`), and every list and lookup uses it.

**What each role may do:**

| Action | Owner | Admin | Member | Guest |
| --- | --- | --- | --- | --- |
| Work in teams they can see (issues, comments, attachments, projects, documents, views, cycles, relations, reactions) | ✓ | ✓ | ✓ | ✓ (their teams only) |
| Join a public team themselves | ✓ | ✓ | ✓ | — |
| Create teams (becomes team owner) | ✓ | ✓ | ✓ | — |
| Invite to the workspace | ✓ any role | ✓ up to admin | ✓ member or guest | — |
| Workspace labels, project labels, project statuses, initiatives | ✓ | ✓ | ✓ | — |
| Change a role, suspend, unsuspend | ✓ anyone | ✓ members and guests | — | — |
| Make or remove an owner | ✓ | — | — | — |
| Webhooks (team and all-teams), god mode | ✓ | ✓ | — | — |
| Delete a user (god mode) | ✓ | — | — | — |
| Personal API keys | ✓ | ✓ | ✓ | ✓ |

**Team management** (team settings, states, cycle settings, team labels, adding and
removing members of a private team, making team owners, visibility, deletion):
team owners and workspace admins and owners. A team with no owners is managed by
any of its members. Any member may leave a team; adding someone to a public team is
allowed for any team member.

**Invariants:** at least one workspace owner; nobody invites or promotes above
their own role.

**Suspension is how someone leaves the workspace** (Linear has no other removal):
a suspended user cannot sign in, their sessions end, their API keys stop working,
and they receive no notifications; their user row, memberships and subscriptions
stay so authorship and history read correctly, and unsuspending restores them.
Hard deletion of a user stays in god mode for owners only (builder's call).

**Invites** (Linear accepts an invite on sign-up): an account created with a
pending workspace invite for its email takes the invite's role and teams at
creation, in the better-auth user-create hook, and the invite is consumed; there
is no separate accept step. Without an invite, sign-up (when the instance allows
it) creates a member. Inviting an email that already has an account is
INVALID_INPUT (it is already in the workspace; a suspended user is unsuspended
instead). The migration adds pending team invites for existing accounts as
memberships directly and turns the rest into workspace invites (builder's call).

**Webhooks:** an all-teams webhook receives events of public teams only (Linear's
`allPublicTeams`). A webhook on a private team can be created or managed only by
an admin or owner who is a member of that team (builder's call).

## Where it is enforced

One module (`apps/api/src/shared/access.ts` rewritten) with functions such as
`workspaceRole(user)`, `canSeeTeam`, `assertTeamMember`, `assertTeamManager`,
`assertWorkspaceRole(user, minimum)`, and the SQL helpers the lists use
(`visibleTeamIds`, `memberTeamIds`). REST guards (`permission: [...]` macros, `entityGuard`) and GraphQL
resolvers call it; the matrix, `PERMISSION_RESOURCES`, `teamsGranting` and the roles
routes and pages are removed.

## Webhooks and GraphQL details

- Team-scoped webhook events keep their current team scoping.
- `User.admin` = owner or admin; `User.owner`, `User.guest`; `User.active` = not
  suspended.
- `userChangeRole(id, role)` accepts `owner`, `admin`, `user` (Linear's name for
  member), `guest`; `app` is INVALID_INPUT.

## Left to the builder

File layout, the exact helper names, the REST route shapes for invites and
self-join, the web pages (members, invites, team list, join button, role select),
and the order of the work.
