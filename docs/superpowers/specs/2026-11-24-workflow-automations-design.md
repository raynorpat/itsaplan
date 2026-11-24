# Workflow automations (Linear's WorkflowDefinition)

Replaces the team actions removed in project 1 with a bare-minimum version of Linear's
workflows: team automations for issues. API only; the web UI comes in the later pass
that matches the web to the GraphQL features.

Linear's public SDL has a `WorkflowDefinition` type but no query or mutation to list,
create, change or run one; it is referenced only from `Favorite.workflowDefinition`,
the issue source filter (`workflowDefinitionId`) and `WorkflowDefinitionNotification`.
Its `conditions`, `activities` and `schedule` fields are untyped JSON. Linear manages
workflows through its private app API, so this instance manages them through the
better-auth instance plugin (as the team owner change in stage 5.5) and defines the JSON
below.

## Goals

### Model

- A `workflow_definition` table with the fields of Linear's type that this feature uses:
  id, slug id, name, description, icon, color, team, `type` (`automation` only),
  `triggerType` (`issue` only), `trigger` (`entityCreated` | `entityUpdated`),
  `activationMode` (`conditionsStartedMatching` for `entityUpdated`; null for
  `entityCreated`), `conditions` (JSON), `activities` (JSON), `enabled`, `sortOrder`,
  `editAccess` (`everyone` | `teamOwners` | `workspaceAdmins` | `owner`), owner,
  creator, last updated by, `lastExecutedAt`, `stats` (`{ runs, lastError? }`),
  timestamps, `archivedAt`. Other `WorkflowType`s, trigger types and triggers are not
  supported; the plugin refuses them.

### When a rule runs

- After an issue is created or updated by a person or a token (GraphQL, MCP, batch
  updates, label add / remove, agent and app tokens included — every path through the
  issues store's `createIssue` / `updateIssue`), the enabled, unarchived automations
  of the issue's team run in `sortOrder`. System updates do not trigger rules: cycle
  rollover and cycle archiving, the automatic cancel of a duplicate, the restore
  move out of an archived column, archive / unarchive, the worker's auto-archive,
  and changes to subscribers or relations alone (builder's call; they pass an opt-out
  or bypass the store).
- `entityCreated`: the rule runs when the new issue matches `conditions`.
- `entityUpdated` + `conditionsStartedMatching`: the rule runs when the issue did not
  match `conditions` before the change and matches after it (Linear's default for
  update rules).
- An empty `conditions` matches every issue. An `entityUpdated` rule must have
  conditions (an empty one could never "start matching"); the plugin refuses it.
- Rules run in the API, in the same request, right after the person's change is
  saved (user's choice), so the issue a client reads back and the board already
  include the workflow's changes. The workflow's change is its own issue update, with
  its own history entry and its own Issue webhook event (as in Linear, where an
  automation's change appears as a separate entry by the workflow); see Attribution
  (builder's call).

### Conditions

- Linear's `IssueFilter` JSON (the format saved views use), evaluated by the same SQL
  filter code that evaluates view filters (`issueFilterSql`), on the one issue row:
  once before the person's write and once after it, all of a team's rules in one
  query each time. The filter code moves out of `graphql/` to where both the GraphQL
  layer and the issues store can import it. "Me" in a condition (`isMe`) is the
  rule's owner. Conditions are validated when a rule is saved (unsupported fields are
  refused) (builder's call).

### Actions (`activities`)

- A list of `{ type, … }` entries:
  - `setState` (`stateId`), `setAssignee` (`userId` or null), `setPriority` (0–4),
    `addLabels` / `removeLabels` (`labelIds`), `setProject` (`projectId` or null),
    `setCycle` (`cycleId` or null), `setDelegate` (`appUserId` or null),
    `addComment` (`body`, Markdown).
- The field changes of all matching rules are applied as one issue update after the
  person's change, in rule order (a later rule's value for the same field wins).
  Comments are added after the update.
- Actions are validated when the rule is saved: states, labels, cycles and the team
  must belong to the rule's team (workspace labels allowed); the assignee must be able
  to be assigned in the team; the delegate must be an installed app user with
  `app:assignable` that sees the team (the stage 6.2 rule). At run time an action
  that no longer fits (archived label, removed member, uninstalled app) is skipped and
  recorded in `stats.lastError`; the others still apply.

### Safety

- A change made by a workflow never triggers workflows again (no loops).
- Each rule runs at most once per issue change.
- A failing rule never fails the person's change: it is logged, recorded in `stats`,
  and the other rules still run.
- Workflows act with the rights of the rule, not of the person who made the change:
  they can set any field the rule's own validation allowed, within the team.

### Attribution

- A workflow's change has no user actor: its history entry stores the workflow
  (`issue_activity` gains a workflow id column) and GraphQL `IssueHistory.botActor`
  resolves to `{ type: workflow, id, name }` (Linear's `ActorBot`; the SDL documents
  `workflow` as a bot type). Its Issue webhook event carries the workflow as the actor
  (`{ id, type: 'workflow', name }`). The web shows "via workflow <name>" in the later
  UI pass (builder's call).
- Because the change has no user actor, the person who made the original change is
  notified like anyone else (for example when a rule assigns them). For delegation,
  the rule's owner is the agent session's creator (stage 6.2 needs a person there).
- A workflow's comment has no user author: `comment` gains a workflow id column and
  `Comment.botActor` resolves to the workflow; the workflow subscribes no one, and
  the members it mentions are subscribed and notified as for any mention. Nobody can edit it; team managers and admins
  can delete it (builder's call).
- `lastExecutedAt` and `stats.runs` are updated on each run.

### Managing rules

- Instance plugin endpoints under `/api/auth/instance/workflows*` (session cookie, the
  Origin check): list a team's rules, get one, create, update, enable / disable,
  reorder, archive, unarchive, delete.
- Who may edit, following `editAccess`: `everyone` — any member of the team who can
  work in it; `teamOwners` — team managers (project 2) and workspace admins;
  `workspaceAdmins` — admins and owners; `owner` — the rule's owner and admins. The
  default is `teamOwners`. Anyone who can see the team can list its rules. Guests and
  app users cannot edit rules.
- A rule acts as its owner (`isMe`, the creator of the agent sessions it starts), so
  the owner is always the rule's last author: its creator, then whoever changes its
  conditions or actions. No one can make another person a rule's owner.

### GraphQL

- `WorkflowDefinition` resolves where this instance's GraphQL reaches it (`botActor`
  references through its id, and the issue source filter's `workflowDefinitionId`,
  which matches no issue since workflows here create none — `sourceMetadata` support
  is added for it), with the fields the model has; unsupported fields resolve to null
  or defaults. Favorites do not exist in this instance and are not built here.

## Non-goals

- Favorites (`Favorite.workflowDefinition`, `favoriteCreate`).
- Other workflow types (triage, SLA, release, view subscriptions), schedules, triggers
  other than issue created / updated, other entity types, AI ("intelligence"),
  `runOnce`, `applyToSubTeams`, workflows that create issues, `WorkflowDefinitionNotification`.
- The web UI (later pass). Manual runs of a rule (the old team actions' macros).

## Anti-goals

- A loop, or a rule running twice for one change.
- A workflow failure that fails or slows a person's change beyond the rules' own work.
- A rule that can change something outside its team, or that a guest or app user can
  edit.

## Approaches

1. **Run rules in the API right after the change is saved (chosen).** Immediate, like
   Linear; the client reads back the final issue; best-effort so a failure never
   fails the edit. The workflow's change is a separate update with its own webhook
   event, attributed to the workflow.
2. **Run rules in the worker from a queue.** Retries and no request cost, but a delay
   of seconds, and the issue changes twice in front of people.
3. **Database triggers.** Rejected: access checks, history and webhooks live in the API.

## Left to the builder

Endpoint shapes, the exact JSON validation, how the before / after match reuses the
view filter code, how history marks the workflow (within the existing history model),
and the order of the work.
