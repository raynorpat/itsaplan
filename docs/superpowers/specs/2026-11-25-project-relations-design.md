# Project relations and the projects timeline

## Intent

Teams that plan work across several projects need to say "this project can't start until
that one ends" and see it on a roadmap. Linear does this with project dependencies shown
on the project page and as arrows on its projects timeline. This app has neither; this
project adds both.

## Goals

### Project relations (Linear's `ProjectRelation`)

- A relation is a **dependency** (`type` is always `dependency`): the source project's
  anchor blocks the related project's anchor. Anchors (`anchorType`,
  `relatedAnchorType`): `start` (start date), `end` (target date) or `milestone` (a
  milestone of that project, `projectMilestoneId` / `relatedProjectMilestoneId`, its
  target date).
- GraphQL: `projectRelation(id)`, `projectRelations`, `projectRelationCreate`,
  `projectRelationUpdate`, `projectRelationDelete`, `Project.relations` (where the
  project is the source) and `Project.inverseRelations` (where it is the related one),
  `ProjectRelation.{project, relatedProject, projectMilestone, relatedProjectMilestone,
  user, …}`.
- **Rules** (builder's call where Linear is silent): both projects must be visible to
  the user, who must be able to edit the source project; a milestone anchor must belong
  to its project and `milestone` needs one (other anchors take none); no relation of a
  project to itself; one relation per pair of anchors; no cycle of dependencies
  between projects (INVALID_INPUT). A relation is visible when both projects are.
  Deleting either project (or the anchoring milestone) deletes the relation; archiving
  or trashing a project hides its relations while it is archived.
- **Conflict:** a relation is in conflict when the blocking anchor's date is after the
  blocked anchor's date (end = target date, start = start date, milestone = its target
  date). Missing dates never conflict. Computed on read, not stored.
- No webhooks for relations (Linear's webhook resource list here has none; builder's
  call).

### Project page

- A **Dependencies** section on the project's Overview: **Blocked by** and **Blocking**
  lists, each row showing the other project, both anchors in words ("Its end → this
  project's start") and a warning when in conflict; **Add dependency** (pick blocked by /
  blocking, the other project and the two anchors) and remove. Guests read only.

### Projects timeline

- The projects list gets a **Table / Timeline** switch inside each status tab (the
  Deleted tab stays a table), so the tab, the team picker and the search filter the
  timeline as they filter the table. The layout and the timeline's grouping are kept per
  person through a new `projects` view type in the user view preferences
  (`userViewPreferences`); the table's sort stays in the URL (builder's call). The table
  gains no grouping.
- The timeline loads every project matching the tab and filters (no paging; builder's
  call: project counts are small).
- Each project with dates is a bar from start date to target date (a project with only
  one of the two shows as a point on that date); milestones are diamonds on the bar at
  their target dates; the bar's colour is its status colour; health shows as on the
  table.
- Projects without dates are listed under **No dates** at the bottom; dragging one onto
  the timeline gives it dates.
- **Dragging** a bar moves both dates, dragging an end changes that date, dragging a
  milestone diamond changes its target date, through the issue timeline's drag code;
  vertical movement does nothing for projects (no group reassignment); guests cannot
  drag.
- **Grouping** by none, status, team, lead or initiative. A project with several teams
  or initiatives appears in each of those groups (one with none under "No team" / "No
  initiative"); every copy shows the same dates and dragging any copy changes the
  project (builder's call).
- **Dependencies** are arrows from the blocking anchor to the blocked anchor, red when in
  conflict; hovering an arrow highlights both projects. With several copies of a project,
  arrows connect the top-most visible copies. When the other project is not on the
  timeline (filtered out, in a collapsed group or under No dates), the visible project
  shows a small "blocked by" / "blocking" marker at that anchor with the other project's
  name in its tooltip, only when the viewer can see that project (builder's call). **Zoom** and **Today** as on the
  issue timeline.
- The issue timeline's scale, header, zoom and drag code become shared timeline pieces
  used by both lists; the issue timeline behaves exactly as before.

## Non-goals

- Relation types other than dependency, initiative timelines, auto-scheduling (moving
  blocked projects when a blocker moves), notifications about conflicts.

## Anti-goals

- A relation revealing a project the viewer cannot see.
- The issue timeline changing behaviour during the refactor.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migration. Follow
  the AGENTS.md files and DESIGN.md (web features do not import each other; shared
  timeline pieces go in the shared layer).

## Approaches

1. **Reuse the issue timeline for projects (chosen by the user).** One shared scale,
   zoom and drag; arrows drawn over it.
2. A separate projects timeline. Rejected: two copies of the scale and drag logic.
3. A Gantt library. Rejected: new dependency, does not match DESIGN.md or the issue
   timeline.

## Left to the builder

Table shape, arrow routing and drawing, the No dates drop interaction, the add-dependency
dialog layout, and the order of the work.
