# Web on GraphQL — Stage 5.3: projects and initiatives

Follows stages 5.1 and 5.2 (`docs/superpowers/specs/2026-11-23-web-graphql-stage*-design.md`):
GraphQL client, `gql.tada check`, refresh rules, request batching, the issue page
(including the document sheet and comment components), the board and the inbox.

## Intent

Move the projects area to GraphQL and build the parts the API has had since the
GraphQL stages and the web never showed: project updates with health, project
comments, project documents and initiatives.

## Goals

### Projects on GraphQL

- **List** (`/projects`): `projects(filter, first, after)` with Linear's cursor paging
  and a "Load more" button (offset pages go); team, status and search filters (the
  search as a `name: { containsIgnoreCase }` filter); the status tab counts from one
  count query per status (`projects(filter: { status }, first: 0)`-style or the
  cheapest supported way to get a count — `ProjectConnection` has no `totalCount`, so
  paging ids is acceptable; builder's call); sort by Linear's fields in
  the browser over loaded rows where the server has no sort.
- **Detail** (`/projects/[projectId]`), in Linear's tabs:
  - **Overview:** description (editor), properties (status, lead, members, start /
    target dates, priority, teams, labels), progress and scope (`progress`, `scope`),
    milestones (list, create, edit, delete, reorder), latest update with health, and
    project comments (the 5.1 comment components with a project target).
  - **Updates:** the project's updates newest first; post an update with a health
    (`onTrack` / `atRisk` / `offTrack`) and a Markdown body; edit and delete own
    updates; comments and reactions on an update.
  - **Issues:** the project's issues board as today (using 5.2's board data and writes).
  - **Documents:** the project's documents (list, create, open in the 5.1 document
    sheet, edit, delete to trash, comments).
  - Activity from `Project.history`, the project's comments and its updates, shown on
    Overview (builder's layout). Like Linear, the project's activity no longer mixes
    in the activity and comments of every linked issue; each issue's activity stays on
    the issue (builder's call).
- **Members** (Linear's project members): the API gains them in this stage, since it
  has none today — a `project_member` table (project, user), `Project.members`,
  `memberIds` on `projectCreate` / `projectUpdate` (replaces the list), members must
  be able to see the project (INVALID_INPUT otherwise), the lead is not added
  automatically; the Overview shows and edits them (builder's call).
- **Create / edit / delete** projects through `projectCreate` / `projectUpdate` /
  `projectDelete` (teams through `teamIds`).
- **Project labels** settings page on `projectLabels` / `projectLabelCreate` /
  `Update` / `Delete`.

### Initiatives (new)

- A sidebar entry **Initiatives** in the workspace section next to Projects, for
  owners, admins and members (guests see none, per project 2).
- **List** (`/initiatives`): status (Planned, Active, Completed), health, owner,
  target date, project count; filter by status; create.
- **Detail** (`/initiatives/[initiativeId]`): overview (description, properties:
  status, owner, target date, lead team), linked projects (add / remove via
  `initiativeToProjectCreate` / `Delete`), sub-initiatives (add / remove via
  `initiativeRelationCreate` / `Delete`, Linear's depth limit enforced by the API),
  updates with health, comments and reactions on the updates (an initiative has no
  comments of its own in Linear's schema); edit, archive, unarchive, delete
  (`initiativeUpdate` / `initiativeArchive` / `initiativeUnarchive` /
  `initiativeDelete`).

### Cleanup

- `lib/api.ts` loses every project method once no caller remains.

## Non-goals

- Cycles (5.4), settings, members and account (5.5).
- Roadmaps / timeline views across projects beyond what the projects list already
  shows.

## Anti-goals

- A control offered to someone the API refuses (project 2 roles and visibility:
  project writes need team access; initiatives follow their lead team).
- Losing anything the project page shows today, except the linked issues' activity
  in the project feed (Linear keeps it on each issue).

## Approaches

1. **Linear's project tabs plus a new Initiatives section (chosen).**
2. **One long project page with sections.** Rejected: Linear's tabs keep Updates and
   Documents findable and match how Linear clients link to them.

## Left to the builder

Component layout, how the health picker looks, the count query mechanism, milestone
reordering, and the order of the work.
