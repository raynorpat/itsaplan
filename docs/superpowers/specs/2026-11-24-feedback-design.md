# Feedback: requesters and feedback on issues and projects (feedback project 1)

## Intent

A software team collects feedback from the people who use its product and needs to see,
on each issue and project, who asked for it, what they said and how many people want it.
This project is the base of a feedback programme planned in this order:

1. **Feedback and requesters** (this document).
2. Client portal: public or restricted boards with comments and votes.
3. Inbound forms: a form builder whose submissions become issues and feedback.
4. Outbound updates and summaries to requesters.
5. Feedback reports.
6. Customers (Linear's organisations), optional, for agencies and B2B teams.

Requesters are people, not companies (user's decision); Customers come later as an
optional grouping.

## Goals

### Data, on Linear's model

- **Requester = Linear's `ExternalUser`** (name, display name, email, avatar): a person
  outside the workspace. One per email address (lowercased); a requester without an
  email is allowed when the team logs feedback for someone they only know by name.
- **Feedback = Linear's `CustomerNeed`** on an issue: `body` holds the quote,
  `priority` 1 marks it important (0 otherwise), `createdAt` the original date, `creator`
  the member who logged it (null when it came from the portal or a form later).
- **Who asked:** each feedback item has an `Attachment` on its issue
  (`CustomerNeed.attachment`) with `externalUserCreator` = the requester, `sourceType`
  `feedback`, `title` the requester's name, `subtitle` the source ("Logged by Pat",
  later "Portal", "Form"), `url` a link to the feedback item's place in the web app, and
  `groupBySource` true.
- **Creating feedback (builder's call, Linear's pattern for requests from a source):** the
  web first creates the requester's attachment through the instance endpoint
  `/api/auth/instance/feedback/attachment` (issue id, requester id, source; Linear's
  `AttachmentCreateInput` cannot name an external creator), then calls Linear's
  `customerNeedCreate({ issueId, attachmentId, body, priority })`. A GraphQL or MCP client
  may still create feedback without a requester through `customerNeedCreate` alone.
  Moving feedback to another issue (`customerNeedUpdate` with `issueId`) moves its
  attachment with it.
- **Feedback belongs to issues only (builder's call):** `CustomerNeedCreateInput` has no
  `projectId`, so a project's feedback is the feedback on its issues.
- GraphQL: `customerNeed(id)`, `customerNeeds(filter)`, `customerNeedCreate`,
  `customerNeedUpdate`, `customerNeedArchive` / `Unarchive`, `customerNeedDelete`;
  `Issue.needs`, `Project.needs`, `CustomerNeed.issue` / `project` / `attachment` /
  `creator`; `Attachment.externalUserCreator`; `IssueFilter.needs`, `customerCount`,
  `customerImportantCount`; `IssueSortInput.customerCount`, `customerImportantCount`.
  While Customers are off, `customerCount` counts **distinct requesters** of the issue and
  `customerImportantCount` those with important feedback (builder's call: the closest
  meaning; when the optional Customers project lands, a requester grouped under a customer
  counts as that customer).
- Requesters are created and edited through the instance's own endpoints
  (`/api/auth/instance/requesters*`: list with search, create, update, merge) because
  Linear's schema has no mutation for `ExternalUser`; they are read through GraphQL
  wherever Linear exposes `ExternalUser`.
- Feedback writes follow the issue's access rules for **members, admins and owners**:
  anyone of them who may edit the issue may add, edit, mark important, move or delete its
  feedback. **Guests cannot add or change feedback, and see no requester names, emails or
  quotes**; on an issue they see "4 people asked for this" (hidden when nobody asked)
  (builder's call: avoids revealing who exists). Linear's schema has no per-issue count a
  guest can read, so the count comes from the instance endpoint
  `/api/auth/instance/feedback/count?issueId=` (anyone who can see the issue; the number
  of distinct requesters of its active feedback only) (user's decision).
- Requesters: any member may create and edit them; **merging** two requesters is for
  owners and admins (it cannot be undone) (builder's call).
- Creating feedback does not notify anyone and runs no workflow automation; it does send
  Linear's `CustomerNeed` webhook events where webhooks subscribe to them (builder's call:
  follow the existing webhook resource list; add `CustomerNeed` as a resource type).

### Web

- **Issue page** (members; guests see "4 people asked for this" only): a **Feedback** section under the description (above sub-issues):
  "Feedback · 4 people", each item with the requester's avatar and name, the quote, an
  "Important" marker, the source and date, and a ⋯ menu (edit, mark important, move to
  another issue, delete). **+ Add feedback**: pick or create a requester (search by name
  or email; "New person" with name and optional email), paste the quote, mark important.
- **Project Overview:** a Feedback section listing the feedback on the project's issues,
  grouped by issue (adding happens on an issue).
- **Issue lists and boards:** a **Requests** display property (number of people; a small
  marker when one is important), a filter "Requests: has any / important", and ordering
  by number of requests (Linear's `customerCount`).
- **Insights** gains two measures: **Requests** (feedback items) and **Requesters**
  (distinct people), with slicing as for the other measures.
- **Requesters page** (sidebar, Workspace → Feedback → People; members only): list with
  name, email, number of feedback items, last feedback date; a person's page with their
  feedback grouped by issue and their status; edit name / email; merge two people (owners
  and admins).

## Non-goals

- Feedback owned by a project without an issue.
- The portal, forms, votes, outbound updates, reports and Customers (later projects).
- Importing feedback from Intercom, Zendesk, Slack or email.
- Requesters signing in (the portal project adds that).

## Anti-goals

- Feedback creating notifications or automation runs for every item.
- Requesters' email addresses visible to guests.
- Two requesters for the same email address.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Follow
  the project's AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.

## Approaches

- **Linear's `ExternalUser` + `CustomerNeed` + attachment (chosen):** the requester and
  the source are readable through Linear's own types and filters; only requester writes
  need the instance's endpoints.
- Rejected: a separate feedback table outside Linear's model (no Linear client could read
  it); Linear's `Customer` for each person (wrong meaning, and it collides with the
  optional Customers project).

## Left to the builder

Table shapes, endpoint payloads, the attachment `url` target, how "move to another issue"
updates the attachment, component layout, and the order of the work.
