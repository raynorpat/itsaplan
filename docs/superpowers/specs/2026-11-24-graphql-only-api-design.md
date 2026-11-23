# Project 7: MCP and tests on GraphQL, REST removed

Last project of the Linear-only roadmap. Projects 1–6 made `/graphql` the web's only data
API and added OAuth and the agent API. Two things still use the REST routes: the MCP
server, whose ~70 tools are generated from REST routes (`x-mcp`) and run them in
process, and most API tests (81 of 93 files call REST). This project moves both to
GraphQL and deletes REST, so the instance has one data API (`/graphql`) plus better-auth
(`/api/auth/*`).

## Goals

### MCP on GraphQL with Linear's tool set

- The MCP server exposes Linear's hosted MCP tool set (user's choice), each tool running
  one GraphQL operation (or a small fixed set) as the caller, with the same scope rules
  as GraphQL (read tools need `read`; writes need `write`, issue creation also accepts
  `issues:create`, comment creation `comments:create`). Linear does not publish the full
  list; this set follows the tools its server is known to expose and the names its
  changelog confirms (`list_issues`, `list_cycles`, `list_users`):
  - Issues: `list_issues` (filters: team, state, assignee, label, project, cycle,
    free-text query, `completedAt` as an ISO-8601 date or duration such as `-P7D`,
    limit / cursor), `list_my_issues`, `get_issue`, `create_issue`, `update_issue`.
  - Comments: `list_comments`, `create_comment`.
  - Projects: `list_projects`, `get_project`, `create_project`, `update_project`,
    `list_project_labels`.
  - Teams and people: `list_teams`, `get_team`, `list_users`, `get_user`.
  - Statuses and labels: `list_issue_statuses`, `get_issue_status`,
    `list_issue_labels`, `create_issue_label`.
  - Cycles and documents: `list_cycles`, `list_documents`, `get_document`.
- Arguments accept names, keys or ids where Linear's do: a team as key, name or id; a
  person by id, email or part of their name (an ambiguous match returns the candidates
  instead of acting); states, labels, projects and cycles by name or id within the
  team.
- `/mcp/readonly` (new) lists and runs only the read tools, with its own 401
  resource-metadata pointer and `/.well-known/oauth-protected-resource/mcp/readonly`;
  `/mcp` lists all tools (a token with only `read` is refused on write tools with an
  error naming the scope).
- Each tool runs its GraphQL operation in process as the caller, passing on the
  caller's own credential, so GraphQL's access and scope checks apply unchanged; the
  MCP-specific identity plumbing for REST goes (builder's call).
- `read` is always part of an OAuth grant, as Linear documents ("this scope will
  always be present"), so a token with `issues:create` or `comments:create` can also
  resolve names; `packages/auth` adds `read` to every grant and existing tokens are
  read as having it (builder's call).
- The server sends default instructions on how to use its tools (as Linear's does).
  The current instructions' workflow rules are kept, rewritten for the new tool names:
  move an issue to a started state before working on it and to completed or canceled
  after, comment only when part of the work was not done, and propose a one-line
  commit message in chat without committing (builder's call).
- `list_issues`' `completedAt` duration (`-P7D`) is converted to a date before the
  GraphQL query; GraphQL date filters take dates.
- Tool results are compact JSON with the fields a model needs (identifiers, titles,
  states, URLs), not full GraphQL payloads.
- Authentication and transport stay as they are: OAuth (stage 6.1) and API keys as
  `Authorization: Bearer`, Streamable HTTP.
- Today's admin tools (webhooks, suspending users, reordering states, invites, label
  groups, views and so on) are removed; they are not in Linear's set.

### Tests on GraphQL

- Each REST test file is rewritten to call GraphQL (or the MCP / better-auth endpoints
  it is about), or deleted where a GraphQL test already covers the same rule. Tests of
  behaviour that only REST has are deleted with the routes.
- The rules the REST tests protected (access, visibility, validation, webhooks,
  history, notifications, worker jobs) keep at least one test each after the move.
- The MCP tests are rewritten for the new tools.
- The Eden Treaty client and REST helpers go; test helpers call `/graphql`. GraphQL
  setup helpers (create a team, issue, project, member and so on) come first, since
  many GraphQL tests still create their data through REST; tests of the kept internal
  and file routes call them through `app.handle`.

### REST removed

- All REST data routes, their OpenAPI document and the API docs page in the web, the
  `x-mcp` route tagging and the REST-to-MCP generator, and REST-only store code that
  nothing else uses.
- Kept: `/graphql`; better-auth under `/api/auth/*` (incl. the instance plugin);
  `/mcp` and the new `/mcp/readonly`; the OAuth paths and discovery documents; the
  health check; the file routes `PUT /uploads/:token`, `GET /uploads/:id/raw`,
  `GET /avatars/:id/raw`, `GET /attachments/:publicId/raw`; the worker's internal
  routes (`/internal/notification-deliveries/send`, `/internal/webhooks/issues-archived`,
  `/internal/cycles/tick`, `/internal/uploads/cleanup`). These are not data APIs;
  Linear has the same outside its API. The file routes get their own mount with the
  session handling and error handling they get from the REST mount today.
- Removed with their tests: `/me`, `/auth-config`, `POST /me/avatar`, multipart
  `POST /issues/:id/attachments`, `/attachments/import`; the web already uses
  `fileUpload` + `attachmentCreate` / `userUpdate` and the instance plugin.
- The worker, migrations on startup and the Docker test gate keep working.

### Docs

- README, the AGENTS.md files and `.env.example` describe GraphQL as the only data API
  and list the kept non-data routes.

## Non-goals

- New GraphQL features. Linear's `searchDocumentation` / `search_documentation` tool
  (Linear's own docs), customer needs and other tools for features this app does not
  have.

## Anti-goals

- An MCP tool that lets a token do more than the same token can do on `/graphql`.
- A rule that was tested before and has no test after.
- Removing a route something still calls (the web, the worker, MCP clients, uploads).

## Approaches

1. **Linear's MCP tool set on GraphQL (chosen).** Prompts and setups written for
   Linear's MCP server work here; the admin tools go.
2. **Keep our ~70 tools, pointed at GraphQL.** Rejected: a tool set only this app has.
3. **One generic GraphQL tool.** Rejected: models do worse with it and Linear does not
   offer it.

## Left to the builder

Each tool's exact argument schema and result fields (following Linear's where known),
how name / key / id resolution is shared, which REST tests are rewritten versus
deleted, and the order of the work.
