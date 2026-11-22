# Linear-compatible GraphQL API — Stage 6: issue relations

Follows stages 1–5 (`2026-11-2*-linear-graphql-stage*-design.md`).

## Intent

Linear tools and agents record and read "A blocks B", "related" and "duplicate of"
between issues to order work. Stage 6 adds Linear's `IssueRelation`. Standing rule:
when unsure, do what Linear does.

## Goals, non-goals, anti-goals

- Goals: `issue_relation` storage; `issueRelation`, `issueRelations`,
  `Issue.relations`, `Issue.inverseRelations`; `issueRelationCreate`, `Update`,
  `Delete`; the IssueFilter fields `hasBlockedByRelations`, `hasBlockingRelations`,
  `hasDuplicateRelations`, `hasRelatedRelations`; relation changes in both issues'
  history; a duplicate is closed.
- Non-goals: REST routes and web UI for relations (the web only renders the new
  history entries); a webhook type (Linear has none for relations); creating
  `similar` relations.
- Anti-goals: a relation visible to someone who cannot see both issues; two
  relations between the same pair of issues; an issue related to itself.

## Approaches

1. **A relation table next to the issue store (chosen).** `issue_relation` with the
   rules in `issues/relations.ts`, GraphQL resolvers calling it, as in earlier stages.
2. **Relations as columns or JSON on the issue.** Rejected: Linear exposes relations
   as entities with ids, and a pair needs one row, not two copies.

## Data model

`issue_relation`: `id`, `issue_id` (FK issue, cascade), `related_issue_id` (FK issue,
cascade), `type` (`blocks`, `duplicate`, `related`; check), `created_at`,
`updated_at`. Check `issue_id <> related_issue_id`. Unique on the unordered pair
(`least(issue_id, related_issue_id)`, `greatest(...)`). The baseline migration is
regenerated; the dev database is reset before `db:migrate`.

Meaning (Linear): `blocks` — the issue blocks the related issue; `duplicate` — the
issue is a duplicate of the related issue; `related` — symmetric.

## Rules

- One relation per pair in either direction: a second create is INVALID_INPUT;
  `issueRelationUpdate` changes `type`, `issueId` or `relatedIssueId` under the same
  checks. Self-relations are INVALID_INPUT. `similar` on create or update is
  INVALID_INPUT (Linear generates those itself).
- Relations may cross teams.
- **Duplicate:** creating a `duplicate` relation, or changing one to `duplicate`,
  moves the issue (the duplicate) to its team's canceled-type state named
  "Duplicate" (case-insensitive), else the team's first canceled-type state by
  position — unless the issue is already in a completed or canceled state. The
  move goes through `updateIssue`, so it is logged and sends the Issue webhook.
  Removing the relation does not reopen the issue.
- **History:** adding, changing or removing a relation records activity on both
  issues: action `relation`, `subject` the relation as seen from that issue
  (`blocks`, `blocked_by`, `duplicate_of`, `duplicated_by`, `related`), `toText`
  the other issue's identifier when added, `fromText` when removed (a change is a
  removal plus an addition). The web feed renders these as sentences.

## Access

- A relation is visible when both issues are visible to the viewer (team members).
- Create, update and delete need `work_items.edit` in the team of the issue or of
  the related issue, and both issues visible (ENTITY_NOT_FOUND otherwise).

## GraphQL

- `IssueRelation`: `id`, `type`, `issue`, `relatedIssue`, `createdAt`, `updatedAt`,
  `archivedAt` (null).
- `Issue.relations` (rows where the issue is `issue_id`), `Issue.inverseRelations`
  (where it is `related_issue_id`), both visible-only connections.
- Filters (RelationExistsComparator `eq` / `neq`): `hasBlockingRelations` — the
  issue blocks another; `hasBlockedByRelations` — another issue blocks it;
  `hasDuplicateRelations` — it is in a duplicate relation either way;
  `hasRelatedRelations` — it is in a related relation either way. Existence counts
  only relations to issues the viewer can see.
- Unsupported input fields are INVALID_INPUT naming the field.

## Left to the builder

File layout, the exact history sentences, and the activity subject constants.
