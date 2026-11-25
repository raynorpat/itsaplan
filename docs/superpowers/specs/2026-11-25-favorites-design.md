# Favorites

## Intent

Each person pins the things they use most to a Favorites section at the top of the
sidebar, as in Linear, so they reach them in one click.

## Goals

- **Storage and API:** a `favorite` table per person, served through Linear's GraphQL:
  `favorites`, `favorite(id)`, `favoriteCreate`, `favoriteUpdate`, `favoriteDelete`,
  `Favorite.children`, `User.favorites`-style reads where the SDL has them. A person
  reads and changes only their own favorites (Linear: favorites are personal).
- **Kinds** (one target per favorite): issue, project, custom view, cycle, document,
  initiative, issue label, project label, customer, dashboard, team, and the fixed views
  (`predefinedViewType` with an optional `predefinedViewTeamId`, e.g. My issues, a
  team's active cycle). A **folder** (`folderName`) holds favorites; folders are not
  nested (Linear). One favorite per person and target (builder's call: starring twice
  returns the existing one).
- **Starring:** a star in the header of issue, project, view, cycle, document,
  initiative, customer and dashboard pages, filled when it is a favorite; "Add to
  favorites" / "Remove from favorites" in the issue context menu.
- **Sidebar:** a Favorites section above the workspace items, shown when the person has
  any: each favorite with its kind's icon and name, opening the item; folders expand and
  collapse (kept in the browser); drag to reorder (sparse `sortOrder`) and to move into
  or out of a folder; a folder can be renamed and deleted (its favorites move to the top
  level, builder's call); right-click on a favorite offers Remove.
- **Access:** an item the person can no longer see (private team, guest scope, archived
  or trashed) is left out of the list and its GraphQL target reads null; deleting an
  item deletes the favorites that point at it (foreign keys cascade). Customer
  favorites are hidden while Customers is off.

## Non-goals

- Live folders (`liveFolderDefinition`, `liveFolderPreset`), releases, release notes,
  pipelines, pull requests, facets, project / initiative tabs, sharing favorites.

## Anti-goals

- A favorite revealing the name of something the person cannot see.
- One person's favorites visible or changeable by another, or by an OAuth app without
  the person's grant.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migration. Follow
  the AGENTS.md files and DESIGN.md. Web features do not import each other: the star
  button and favorites service are shared code.

## Approaches

1. **Linear's Favorite API, stored per person (chosen).** Linear tools work against it;
   one table with a nullable foreign key per kind.
2. Browser-only favorites in localStorage. Rejected: lost across devices and invisible
   to Linear clients.

## Left to the builder

Table shape (one column per kind with a check that exactly one target or a folder name
is set), icons, the drag interactions within DESIGN.md, and the order of the work.
