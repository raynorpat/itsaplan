# Linear-compatible GraphQL API — Stage 9: notifications and issue subscriptions

Follows stages 1–8 (`docs/superpowers/specs/2026-11-2*-linear-graphql-stage*-design.md`).

## Intent

Linear tools read a user's inbox, mark notifications read, snooze and archive them,
and subscribe people to issues. Stage 9 serves the existing inbox through Linear's
`Notification` API and adds Linear's issue subscriptions, which decide who is
notified. Standing rule: when unsure, do what Linear does.

## Goals

- The inbox over GraphQL as `IssueNotification`s with Linear's type and category
  names: read, snooze, archive, and the bulk mutations.
- Issue subscriptions: `Issue.subscribers`, `issueSubscribe`, `issueUnsubscribe`,
  automatic subscription the way Linear does it, and notifications sent to
  subscribers.
- Existing installations keep their recipients after the upgrade (backfill), plus
  current assignees (see Data model).
- `subscriberIds` on issue create and update, and the `subscribers` issue filter.

## Non-goals

- Web UI for subscriptions or archive. The web inbox and the REST routes keep
  working as they do; the only visible change is that an archived notification
  leaves the web inbox too.
- New kinds of notification (reactions, project, document, initiative, due dates,
  description mentions). The four existing kinds stay.
- `notificationSubscriptions` to teams, projects or labels,
  `notificationCategoryChannelSubscriptionUpdate`: NOT_IMPLEMENTED.
- Changes to email and Telegram delivery or the per-team notification preferences.
- An Issue webhook when only the subscribers change.

## Anti-goals

- A notification visible to anyone but its recipient.
- A user notified about their own action.
- A non-member of the issue's team receiving notifications or listed as a
  subscriber.
- Upgrading an installation drops anyone who receives notifications today.

## Approaches

1. **An `issue_subscription` table (chosen).** One row per issue and user, added
   automatically and by `issueSubscribe`, removed by `issueUnsubscribe`;
   notifications go to subscribers. `Issue.subscribers` is a plain read and the
   reason someone is notified is visible.
2. **Today's derived participants plus an override table.** Rejected: subscribers
   would be recomputed from the issue's whole history on every read, and they
   would exist only implicitly.
3. **Subscriber ids as an array on `issue`.** Rejected: hard to keep correct under
   concurrent writes and cannot be indexed by user.

## Data model

Migrations are incremental from here (`0000` baseline, `0001`, `0002`, …): add a new
migration with `bun run db:generate`; the baseline is not regenerated.

### `issue_subscription`

| column       | notes                         |
| ------------ | ----------------------------- |
| `issue_id`   | FK issue, cascade             |
| `user_id`    | FK user, cascade              |
| `created_at` |                               |

Primary key (`issue_id`, `user_id`); index on `user_id`.

The migration backfills a row for each issue and each team member of the issue's
team who is an actor in its feed (comments and logged changes, which include the
creator's `created` entry), the set notified today, and its current assignee.
Today an assignee who never acted on an issue gets only `assigned`; Linear
subscribes assignees, so after the upgrade they also get `commented` and
`state_changed` (builder's call).

### `notification`

Gains `archived_at` (timestamptz, nullable) and `updated_at` (set on every change).

## Rules

### Subscriptions

- **Automatic** (Linear): the creator and the assignee of a new issue; a new
  assignee; the author of a comment on the issue; a member mentioned in such a
  comment (on create, and newly mentioned on edit). Only members of the issue's team
  are subscribed. Adding an existing subscription changes nothing.
- **`issueSubscribe(id, userId?, userEmail?)`** subscribes the given user, or the
  viewer when neither is given. The target must be a member of the issue's team
  (INVALID_INPUT otherwise). The viewer needs read access to the issue.
- **`subscriberIds`** (Linear's `IssueCreateInput` / `IssueUpdateInput`): on
  create the subscribers are the automatic ones plus the given users; on update
  the list replaces the subscribers, then the update's own automatic triggers (a new
  assignee) apply. Every id must be a member of the issue's team (INVALID_INPUT
  otherwise). Builder's call.
- **`issueUnsubscribe`** removes the row. A later automatic trigger (commenting,
  being assigned or mentioned) subscribes the user again, as in Linear.
- Both return `IssuePayload` and do not bump the issue's `updated_at`.

### Who is notified

- `commented` and `state_changed` go to the issue's subscribers who are team
  members, except the actor (replacing the derived participant set).
- `assigned` goes to the new assignee, `mentioned` to mentioned members, whether
  or not they are subscribed, never to the actor (unchanged).

### Archive

- `notificationArchive` sets `archived_at`; `notificationUnarchive` clears it.
- Archived notifications are left out of the REST inbox list, the unread count and
  the GraphQL `notifications` list unless `includeArchived`; `notification(id)`
  still returns them.
- The REST delete routes keep deleting.

## GraphQL

- **Types:** every notification is an `IssueNotification` (`__typename`), mapped:

  | stored          | `type`                                              | `category`           |
  | --------------- | --------------------------------------------------- | -------------------- |
  | `assigned`      | `issueAssignedToYou`                                | `assignments`        |
  | `mentioned`     | `issueCommentMention`                               | `mentions`           |
  | `commented`     | `issueNewComment`                                   | `commentsAndReplies` |
  | `state_changed` | `issueStatusChanged`                                | `statusChanges`      |

- **Fields:** `id`, `type`, `category`, `user`, `actor`, `issue`, `issueId`,
  `team`, `comment`/`commentId` (the source comment), `parentComment`/
  `parentCommentId` (the root comment when the source is a reply), `readAt`,
  `snoozedUntilAt`, `archivedAt`, `createdAt`, `updatedAt`. `emailedAt`,
  `unsnoozedAt`, `reactionEmoji`, `botActor`, `externalUserActor` are null;
  `subscriptions` is empty.
- **Queries:** `notifications(filter, includeArchived, …)` lists the viewer's own
  notifications, newest first; `notification(id)` returns one of the viewer's
  (ENTITY_NOT_FOUND for anyone else's).
- **Notifications about issues the viewer can no longer see** (they left the team)
  are left out of `notifications`, `notification(id)` and the bulk mutations, so
  `issue` and `team` always resolve. The REST inbox is unchanged (builder's call).
- **`NotificationFilter`:** `id`, `type` (Linear's names), `createdAt`,
  `updatedAt`, `archivedAt`, `and`, `or`. `subscriptionType` is INVALID_INPUT.
- **Mutations:**
  - `notificationUpdate(id, input)`: `readAt`, `snoozedUntilAt` (null clears);
    `projectUpdateId`, `initiativeUpdateId` INVALID_INPUT.
  - `notificationArchive(id)`, `notificationUnarchive(id)`:
    `NotificationArchivePayload` (`entity`).
  - `notificationMarkReadAll(input, readAt)`, `notificationMarkUnreadAll(input)`,
    `notificationSnoozeAll(input, snoozedUntilAt)`,
    `notificationUnsnoozeAll(input, unsnoozedAt)`, `notificationArchiveAll(input)`:
    act on the viewer's notifications that `NotificationEntityInput` names: `id`
    (one notification) or `issueId` (all about that issue). Other input fields are
    INVALID_INPUT. Return `NotificationBatchActionPayload` with the changed
    notifications.
- **`Issue.subscribers`:** the subscribed team members, as a user connection.
- **`IssueFilter.subscribers`** (`UserCollectionFilter`): `some`, `every`, `length`,
  with the user fields the assignee filter supports (`id`, `name`, `email`, `isMe`),
  over the subscribed team members.
- **`issueSubscribe`, `issueUnsubscribe`** as above.

## Webhooks

The `Issue` webhook payload's `subscriberIds` carries the current subscribers.
Subscription changes alone send no event.

## Left to the builder

File layout (likely `apps/api/src/notifications/subscriptions.ts`, a GraphQL
resolver and filter module), how the automatic subscription hooks into issue
create, update and comment code, and the backfill SQL.
