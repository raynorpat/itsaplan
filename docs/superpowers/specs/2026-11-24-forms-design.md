# Forms: inbound request forms (feedback project 3)

## Intent

People outside the workspace send requests to the team through forms the team designs:
a bug report, a feature request, a support question. Each confirmed submission becomes an
issue in the right team with the right labels and priority, plus the person's feedback
(project 1), so it is counted and reported like any other request. Forms are shared as a
link or shown on portal boards (project 2). This is project 3 of the feedback programme
(1 feedback and requesters, 2 portal, 3 forms, 4 outbound updates, 5 reports, 6 optional
Customers).

Linear models forms as issue templates with form fields. This project implements
Linear's `Template` in the API and builds forms on it.

## Goals

### Templates (Linear's API)

- GraphQL: `templates` (with Linear's filter as far as the fields below), `template(id)`,
  `Team.templates`, `Organization.templates` (workspace templates), `templateCreate`,
  `templateUpdate`, `templateDelete`; `Template` fields `id`, `name`, `description`,
  `icon`, `color`, `type`, `templateData`, `team`, `creator`, `lastUpdatedBy`,
  `sortOrder`, `hasFormFields`, `createdAt`, `updatedAt`, `archivedAt`; others null or
  empty.
- Only type `issue` is accepted; other types are refused with INVALID_INPUT (builder's
  call: the other types have no feature here yet).
- **`templateData` for an issue template** (builder's call; Linear does not document its
  shape): `{ title?, description? (Markdown), stateId?, labelIds?, priority?,
  formFields? }`. State and labels must belong to the template's team (or be workspace
  labels); a workspace template may not set a state.
- **Form fields** in `templateData.formFields`, in order: `{ id, type, label, required,
  options? }`, with `type` one of `shortText`, `longText`, `select`, `multiSelect`,
  `checkbox`. Each `select` / `multiSelect` option is `{ id, label, labelId?, priority? }`:
  choosing it adds that label and / or sets that priority (the last chosen priority
  wins; the template's own priority applies when none is chosen). One field may be the
  **title** field (`shortText`) and one the **quote** field (`longText`)
  (`formFields[].role: 'title' | 'quote'`). Without a title field, the issue title is
  "<form name> from <requester name>".
- Who manages templates (Linear's rule): team templates by the team's members, admins and
  owners (not guests); workspace templates by owners and admins. Guests read the
  templates of their teams. A template that is a form (below) is changed or deleted only
  by owners and admins, also through GraphQL (builder's call: forms are managed in
  Settings, which only they can open).

### Forms (Settings → Workspace → Forms, owners and admins)

- A **form** is a team template with a row in the instance's form settings table; other
  templates, with or without form fields, are not forms and are not listed in Settings →
  Forms (builder's call). The settings row holds the publishing settings Linear's schema
  has no place for (Linear's schema has none): slug (`/forms/<slug>`), intro text,
  **link on / off**, and the portal **boards** it appears on. Publishing settings go
  through the instance endpoints `/api/auth/instance/forms/*`.
- The form editor: name, intro, team, state, labels, priority, the question list (add,
  reorder, mark required, choose the title and quote questions, options with their label
  and priority), the link switch with Copy link, and the board choice. It saves the
  template through `templateCreate` / `templateUpdate` and the publishing settings
  through the instance endpoints.
- Every form also asks for the person's **email** and **name** (unless they are signed in
  to the portal); these are not form fields of the template.
- A form's team must be public (as portal boards, project 2). While its team is private
  the form answers "not found" on its link and is hidden on boards (checked on every
  request). Deleting the template deletes its settings and its pending submissions.
- The link, when on, is open to anyone, also for forms shown on restricted boards; the
  editor says "Anyone with the link can submit" (builder's call).

### Filling in a form

- **On a link** (`/forms/<slug>`): anyone can open it while the link is on; off → "not
  found". The person fills in the questions, their email and name, and submits; the page
  shows "Check your email to confirm your request". The email holds a link to a confirm
  page with a button (mail scanners must not confirm, as for portal sign-in). Confirming
  creates the issue and the feedback and shows "Thanks, your request is in" with the
  issue's portal link when the issue is on a board.
- **Signed in to the portal** (on a link or a board): no email or name fields; submitting
  creates the issue at once (user's decision: confirm unless already signed in).
- **On a portal board:** a form may be placed on a team board of the form's team, or on a
  project board whose project includes the form's team; the issue a form creates from a
  project board is added to that project. A board with forms shows them instead of its
  Suggest box, whether the board's suggestions are on or off (a "Submit a request"
  button with the form names when there are several). On a board, submitting needs
  portal sign-in, as every visitor action does (project 2); the email-confirm flow is
  for the link. "Is it one of these?" runs on the title question before the form is
  submitted, as for suggestions. The board's suggestion label is not added to form
  issues; the form's own state and labels apply (builder's call).
- **Pending submissions** wait in the instance's own table until confirmed; the
  confirmation link works once and expires after 24 hours; unconfirmed ones are deleted
  after that (builder's call).
- Confirming signs the person in to the portal as well (a portal session for that email,
  project 2's rules), so they can follow their request.

### What a submission creates

- The **requester** for the email (project 1: reused when known, created with the given
  name otherwise; a blocked requester's submissions are dropped silently).
- An **issue** in the form's team with the template's state, labels and priority plus the
  options' labels and priority, `Issue.externalUserCreator` = the requester, no member
  creator. Description: the template's description, then each question and answer in
  order ("**Question**" then the answer; unanswered optional questions left out), as
  Linear fills an issue from a form template.
- A **feedback item** (project 1) on it from the requester, source **Form** (attachment
  subtitle "Form: <form name>"), quote = the quote question's answer (none when the form
  has no quote question).
- The issue is a normal creation: webhooks, workflow automations and the team's new-issue
  notifications run, as for portal suggestions (project 2). The board an issue was
  submitted from (a suggestion or a form on a board) is recorded on the issue, and the
  person sees it under their own suggestions ("Under review") on that board until it
  matches the board's filter; this replaces project 2's "active issues in the board's
  suggestion team" rule (builder's call). A link submission is not tied to a board.

### Spam and abuse

- Submissions on a link: rate-limited per email address and per client address (project
  2's limiter and `TRUST_PROXY` rule); confirmation mails count towards the address's
  link limit. Signed-in submissions: rate-limited per visitor as suggestions are.
- The page answers the same for allowed, blocked or rate-limited addresses ("Check your
  email…").
- Answers: required questions enforced, text up to 10,000 characters per answer, options
  only from the form (builder's call).

## Non-goals

- File uploads from the public, conditional questions, email intake addresses, embedding
  a form in another site.
- In-app issue templates for members ("New issue from template" in the app); the API
  supports them, the screens come later.
- Templates of types other than `issue`.
- Restricting a form link by email domain (use a restricted board).

## Anti-goals

- An issue created for an address nobody confirmed (unless signed in to the portal).
- A form that reveals whether an address is known, blocked or allowed.
- A submission that creates two requesters for one email.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Follow
  the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.
- Public form routes are part of the portal's routes (`/portal/forms/*`) with the portal
  session, Origin checks and rate limits (project 2); the web app and API on the same
  site, as project 2 requires.

## Approaches

1. **Forms as Linear issue templates with form fields (chosen by the user).** Templates are
   readable and writable through Linear's API and MCP; publishing settings and pending
   submissions are the instance's own; in-app templates later need no rework.
2. Forms as the instance's own table behind instance endpoints only. Rejected: forms
   unreadable through Linear's API, and in-app templates would later be a second kind of
   template.

## Left to the builder

Table shapes (template, form settings, pending submissions), endpoint paths and payloads,
how the description is laid out in Markdown, the form editor's layout within DESIGN.md,
rate-limit numbers, and the order of the work.
