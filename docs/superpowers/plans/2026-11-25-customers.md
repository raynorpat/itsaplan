# Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's Customers as an optional workspace feature: companies grouping
requesters by email domain or by hand, customer-weighted counts and reports, and portal
boards locked to one customer.

**Architecture:** A `customers/` API folder holds the customer, status and tier store,
the domain matching that keeps `external_user.customer_id` and `customer_need.customer_id`
in step, and the settings. GraphQL serves Linear's Customer types. Instance endpoints
cover what Linear's SDL cannot: the on / off switch, the currency and a person's
customer. The portal reads the visitor's current customer on every request. The web
adds a settings page, Feedback → Customers pages, and customer fields in feedback,
Insights and dashboards.

**Tech Stack:** Bun, Elysia, graphql-yoga with Linear's vendored SDL, Drizzle/Postgres,
better-auth instance plugin, Next.js 15, React 19, TanStack Query, gql.tada, Recharts.

**Spec:** `docs/superpowers/specs/2026-11-25-customers-design.md`

## Global Constraints

- Linear's SDL (`apps/api/src/graphql/schema.graphql`) is never edited; `gql.tada check` passes.
- Incremental migrations: one new migration, `0062_*`, generated with `bun run db:generate`.
- Follow `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `packages/auth/AGENTS.md`, DESIGN.md.
- Web features do not import each other; shared code in `apps/web/src/{utils,services,hooks,components/common}`.
- Settle open choices the way Linear does.
- Customers are off by default; while off, no customer data shows in the web app or portal, GraphQL customer queries return nothing and customer mutations fail with "Customers are not enabled".
- Default statuses on first enable: Active (position 0, the default), Prospect, Churned; no tiers. Revenue currency default `USD`.
- Domains lowercased, unique across customers; public email domains refused.
- A request with a person always has the person's customer; a differing `customerId`/`customerExternalId` is refused (INVALID_INPUT, "The customer of a request follows its requester").
- Bulk request moves are one UPDATE: no `CustomerNeed` webhooks, `updated_at` unchanged.
- Members, admins and owners create, edit, merge and delete customers; guests and app users see none. Statuses, tiers, the switch and currency: owners and admins.
- Commits: one per task, Conventional Commit subject, no trailer or metadata.
- AGENTS.md text describes the final state in plain literal language.

## Review Focus

1. **Domain case and subdomains:** `Bob@ACME.com` matches a customer with `acme.com`; `bob@eng.acme.com` does not (exact domain only). Test in Task 3.
2. **Two people of one company on one issue** count once in `customerCount`, once in the portal vote count of their customer board, and once in the Insights "customers" measure. Tests in Tasks 4, 5, 8.
3. **A visitor whose customer changes mid-session** (manual pick, domain removed, customer deleted or merged) gains or loses the customer board on the very next request. Test in Task 5.
4. **Customers turned off with customer boards in place:** the board is "not found", no sign-in link is sent, `boardsShowingIssue` leaves it out, and the counts fall back to people. Tests in Tasks 4, 5.
5. **Person merge across customers:** A (customer X) merged into B (customer Y): A's requests take Y; B's portal access is Y's. Test in Task 3.

---

## File Structure

API (`apps/api/src/`):
- `customers/settings.ts`: switch, currency, first-enable statuses, `customersEnabled()`, `assertCustomersEnabled()`.
- `customers/statuses.ts`: statuses and tiers store.
- `customers/store.ts`: customers CRUD, merge, delete, upsert, DTO.
- `customers/domains.ts`: public-domain list, `cleanDomains`, matching and need sync.
- `customers/handlers.ts`: instance handlers (settings, person customer).
- `customers/__tests__/integration/{settings,customers,matching,counts}.test.ts`.
- `graphql/resolvers/customer.ts`: queries, mutations, field resolvers.
- `graphql/customer-filter.ts`: `CustomerFilter`, `customerNeed` `customer` filter key.
- Modify: `feedback/store.ts` (need customer on create/update/move; `customerCountSql`), `feedback/requesters.ts` (DTO `customer`, matching on create/email change/merge, `customerId` list filter), `graphql/customer-need-filter.ts`, `graphql/resolvers/customer-need.ts`, `graphql/resolvers/organization.ts`, `webhooks/{store,data}.ts`, `portal/{access,boards,issues,votes,comments,session,admin,routes}.ts`, `forms/public.ts`, `updates/changes.ts`, `instance/handlers.ts`, `apps/api/AGENTS.md`.

DB: `packages/db/src/schema/app.ts`, `packages/db/drizzle/0062_*.sql`.
Auth: `packages/auth/src/instance-plugin.ts`, `packages/auth/AGENTS.md`.

Web (`apps/web/src/`):
- `services/customers.service.ts`, `hooks/useCustomersEnabled.ts` (shared: feedback, customers, dashboards, portal-admin, settings use them).
- `features/customers/` (list and page), `app/feedback/customers/{page,[slugId]/page}.tsx`.
- `features/customers-settings/`, `app/settings/workspace/customers/page.tsx`.
- Modify: `components/common/page/FeedbackNav.tsx`, `components/common/feedback/{IssueFeedback,FeedbackAddDialog,FeedbackRequesterPicker}.tsx`, `features/feedback/PersonPage.tsx` (+ `components/PersonCustomerField.tsx`), `services/feedback.service.ts`, `utils/requests.ts`, `utils/insights/measures.ts`, `utils/dashboards/*`, `services/dashboardData.service.ts`, `features/portal-admin/components/{PortalBoardAccessFields,PortalBoardSourceFields}.tsx`, `features/portal-admin/utils/board.ts`, settings nav.

---

### Task 1: Schema, settings and statuses / tiers

**Files:**
- Modify: `packages/db/src/schema/app.ts`; Create: `packages/db/drizzle/0062_*.sql` (generated)
- Create: `apps/api/src/customers/{settings,statuses,handlers}.ts`, `apps/api/src/graphql/resolvers/customer.ts` (statuses / tiers part)
- Modify: `apps/api/src/graphql/resolvers/organization.ts`, `packages/auth/src/instance-plugin.ts`, `apps/api/src/instance/handlers.ts`, `apps/api/src/__tests__/...instance-plugin.test.ts` (endpoint list)
- Test: `apps/api/src/customers/__tests__/integration/settings.test.ts`

**Interfaces:**
- Produces (DB, all in one migration so later tasks add none):
  - `organization.customers_enabled boolean not null default false`, `organization.customers_revenue_currency text not null default 'USD'`, `organization.customers_seeded boolean not null default false`.
  - `customer_status` (id, name, display_name null, color, description null, position real, created_at, updated_at).
  - `customer_tier` (same columns).
  - `customer` (id, slug_id unique, name, domains text[] default '{}', external_ids text[] default '{}', main_source_id null, owner_id → user set null, status_id → customer_status (not null, restrict), tier_id → customer_tier set null, revenue integer null, size integer null, logo_url null, created_at, updated_at). Uniqueness of domains and external ids is checked in the store under an advisory lock (arrays cannot carry a unique index).
  - `external_user.customer_id` → customer set null, `external_user.customer_source text null` check in (`domain`, `manual`); `customer_source` is null exactly when `customer_id` is null (a deleted customer's set-null clears the source through the store, which nulls both).
  - `customer_need.customer_id` → customer set null, index.
  - `portal_board.customer_id` → customer set null; `portal_board.shows text not null default 'issues'` check in (`issues`, `customerRequests`); access check becomes in (`public`, `restricted`, `customer`); scope check becomes `shows = 'customerRequests' AND team_id IS NULL AND project_id IS NULL OR shows = 'issues' AND (team_id IS NULL) <> (project_id IS NULL)`; check `shows = 'issues' OR access = 'customer'`.
- Produces (API):
  - `customersEnabled(): Promise<boolean>`, `assertCustomersEnabled(): Promise<void>` (throws `HttpError(400, 'Customers are not enabled')`), `getCustomersSettings(userId)`, `saveCustomersSettings(user, { enabled?: boolean, revenueCurrency?: string })` in `settings.ts` (currency: three uppercase letters). First enable inserts Active / Prospect / Churned (colors `#4cb782`, `#5e6ad2`, `#95a2b3`) once (`customers_seeded`).
  - `listStatuses()`, `createStatus(input)`, `updateStatus(id, input)`, `deleteStatus(id)`, and the same for tiers, in `statuses.ts`; `defaultStatusId(): Promise<string>` = lowest position.
  - Instance endpoints: `GET /instance/customers-settings` (owners, admins, members read), `POST /instance/customers-settings/save` (owners, admins). Handlers type `CustomersHandlers` in `packages/auth`.
  - GraphQL: `Organization.customersEnabled`, `Organization.customersConfiguration` = `{ revenueCurrency }`; `customerStatus(id)`, `customerStatuses`, `customerTier(id)`, `customerTiers`, `customerStatusCreate/Update/Delete`, `customerTierCreate/Update/Delete` (owners and admins; guests read nothing).

- [ ] **Step 1: Write the failing tests** in `settings.test.ts`:
  - `customers are off by default`: `organization { customersEnabled customersConfiguration }` → `false`, `{ revenueCurrency: 'USD' }`; `customerStatuses { nodes { id } }` → `[]`.
  - `an admin turns customers on and gets the default statuses once`: save `{ enabled: true }` → statuses `['Active','Prospect','Churned']` by position; off then on again → still 3.
  - `a member cannot change the settings` → 403; `a guest reads customersEnabled but no statuses`.
  - `currency must be three letters`: `'usd'` → 400, `'EUR'` ok, shows in `customersConfiguration`.
  - `status mutations need an admin and Customers on`: member `customerStatusCreate` → FORBIDDEN; with Customers off → INVALID_INPUT "Customers are not enabled".
  - `the last status cannot be deleted` → INVALID_INPUT (moving customers on a status or tier delete is tested in Task 2).
  - `displayName defaults to name`.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/customers` — Expected: FAIL (missing fields/resolvers).
- [ ] **Step 3: Add the schema** and run `bun run db:generate` then `bun run db:migrate && bun run db:migrate:test` from the root. Expected: `0062_*.sql` created and applied.
- [ ] **Step 4: Implement** `settings.ts`, `statuses.ts`, the handlers, the plugin endpoints and the resolvers. Customer statuses and tiers are workspace-wide: no webhooks.
- [ ] **Step 5: Run** `cd apps/api && bun run test src/customers src/auth src/graphql` — Expected: PASS.
- [ ] **Step 6: Commit** `feat: customers settings, statuses and tiers`

### Task 2: Customers in GraphQL

**Files:**
- Create: `apps/api/src/customers/store.ts`, `apps/api/src/graphql/customer-filter.ts`
- Modify: `apps/api/src/graphql/resolvers/customer.ts`, `apps/api/src/webhooks/{store,data}.ts`
- Test: `apps/api/src/customers/__tests__/integration/customers.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, `assertCustomersEnabled`, `defaultStatusId`.
- Produces:
  - `CustomerDto { id, slugId, name, domains, externalIds, mainSourceId, ownerId, statusId, tierId, revenue, size, logoUrl, createdAt, updatedAt }`.
  - `createCustomer(user, input)`, `updateCustomer(user, id, input)`, `deleteCustomer(user, id)`, `mergeCustomers(user, sourceId, targetId): Promise<CustomerDto>`, `upsertCustomer(user, input)` (by the first external id, else create), `getCustomer(user, id)` (id or slugId), `listCustomers(user, { filter, first, after })`.
  - `slugId`: the name lowercased, non-alphanumerics to `-`, trimmed to 40, plus `-` and 6 random hex characters. `url`: `${APP_URL}/feedback/customers/<slugId>`.
  - `mergeCustomers` moves (in one transaction) needs, people (keeping each person's `customer_source`), domains and external ids (union) and `portal_board.customer_id` from source to target, then deletes the source. `deleteCustomer` relies on the FKs (set null).
  - Webhook resource type `Customer` (all-teams webhooks only, as a workspace initiative): create, update, remove; data = the GraphQL mapping (`customerData`). Merge sends an update for the target and a remove for the source.
  - `CustomerFilter` keys: `and`, `or`, `id`, `name`, `domains`, `externalIds`, `owner`, `revenue`, `size`, `status`, `tier`, `createdAt`, `updatedAt`, `needs` (via `customerNeedFilterSql`). `slackChannelId` → INVALID_INPUT.
  - `Customer.status`, `tier`, `owner`, `needs` (active needs on issues the viewer can see), `approximateNeedCount` (Task 4), `archivedAt` null, `integration` null, `slackChannelId` null. `customerUnsync` → INVALID_INPUT "Customer data sources are not supported".
- Public domains: Task 3 owns `cleanDomains`; this task calls it.

- [ ] **Step 1: Write the failing tests** in `customers.test.ts`:
  - `a member creates a customer with the default status`: `customerCreate({ name: 'Acme', domains: ['Acme.com'] })` → `domains: ['acme.com']`, `status.name: 'Active'`, `slugId` starts `acme-`, `url` ends `/feedback/customers/<slugId>`.
  - `a domain used by another customer is refused` → CONFLICT; `a public domain is refused` (`gmail.com`) → INVALID_INPUT; an invalid domain (`not a domain`) → INVALID_INPUT.
  - `an external id is unique` → CONFLICT; `mainSourceId must be one of externalIds` → INVALID_INPUT.
  - `revenue must be a nonnegative integer` (`-1` → INVALID_INPUT); `an app user cannot own a customer` → INVALID_INPUT.
  - `customers lists and filters`: `customers(filter: { tier: { name: { eq: "Enterprise" } } })`, `domains: { some: { eq: "acme.com" } }`... use the StringArrayComparator the SDL defines.
  - `a guest sees no customers` (`customers` empty, `customer(id)` ENTITY_NOT_FOUND, `customerCreate` FORBIDDEN).
  - `with Customers off customers is empty and customerCreate fails` (INVALID_INPUT "Customers are not enabled").
  - `customerUpsert updates by external id`.
  - `merge moves domains and external ids and deletes the source` (needs, people and boards are asserted in Tasks 3 and 5).
  - `deleting a status moves its customers to the default status`; `deleting a tier clears it`.
  - `customer webhooks are sent to an all-teams webhook` (create / update / remove events with `type: 'Customer'`).
- [ ] **Step 2: Run** `cd apps/api && bun run test src/customers` — Expected: FAIL.
- [ ] **Step 3: Implement** the store, filter, resolvers and webhooks. Domain and external-id uniqueness: `pg_advisory_xact_lock(hashtext('customer-keys'))` then an overlap query (`domains && $1`), so concurrent writes cannot both pass.
- [ ] **Step 4: Run** `cd apps/api && bun run test src/customers src/webhooks src/graphql` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): customers in GraphQL`

### Task 3: People and requests follow their customer

**Files:**
- Create: `apps/api/src/customers/domains.ts`
- Modify: `apps/api/src/feedback/{store,requesters,handlers}.ts`, `apps/api/src/portal/session.ts` (`requesterFor`), `apps/api/src/customers/{store,settings,handlers}.ts`, `apps/api/src/graphql/resolvers/customer-need.ts`, `apps/api/src/graphql/customer-need-filter.ts`, `packages/auth/src/instance-plugin.ts`
- Test: `apps/api/src/customers/__tests__/integration/matching.test.ts`

**Interfaces:**
- Consumes: Task 2 store.
- Produces:
  - `PUBLIC_EMAIL_DOMAINS: ReadonlySet<string>` (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, msn.com, yahoo.com, ymail.com, icloud.com, me.com, mac.com, aol.com, proton.me, protonmail.com, pm.me, gmx.com, gmx.de, web.de, mail.com, yandex.com, yandex.ru, zoho.com, fastmail.com, hey.com, qq.com, 163.com, 126.com).
  - `cleanDomains(value: unknown): string[]` (lowercase, trim, strip a leading `@`, dedupe; refuse public and malformed ones; at most 50).
  - `matchPeople(tx, scope: { personIds?: string[] } = {}): Promise<void>`: for people in scope (all when omitted) with `customer_source` not `manual` and not merged: set `customer_id` to the customer whose `domains` contains the email's domain (exact), source `domain`; clear domain-sourced links whose domain no longer matches. Then `syncNeedCustomers(tx, personIds)` for the people it changed.
  - `syncNeedCustomers(tx, personIds: string[]): Promise<void>`: one `UPDATE customer_need SET customer_id = p.customer_id FROM attachment a JOIN external_user p ... WHERE customer_id IS DISTINCT FROM p.customer_id`; `updated_at` untouched; no events.
  - `setPersonCustomer(userId, { id, customerId: string | null })` (instance `POST /instance/requesters/customer`, owners/admins/members, Customers on): a customer id sets `manual`; null clears the pick, then `matchPeople` for that person.
  - Call sites: `createRequester`, `requesterFor` (portal), form submission's requester creation, `updateRequester` when the email changes, `mergeRequesters` (after re-pointing attachments: the kept person keeps their customer, then `syncNeedCustomers([kept])`), customer create / update of domains / merge / delete (`matchPeople` for people whose domain is in the old or new domains), and `saveCustomersSettings` on enable (all people).
  - `RequesterDto.customer: { id: string; name: string; source: 'domain' | 'manual' } | null` (null while Customers off); `listRequesters` accepts `customerId`.
  - `createNeed`: a need whose attachment has an external creator gets that person's `customer_id`; `input.customerId` that differs → `HttpError(400, 'The customer of a request follows its requester')`; without a person, `input.customerId` is stored (must exist; Customers on). `customerNeedCreate` / `customerNeedUpdate` accept `customerId` and `customerExternalId` (both → INVALID_INPUT). Moving a need to another issue keeps its customer. `CustomerNeed.customer` resolves (null while off). `CustomerNeedFilter.customer` (NullableCustomerFilter) supported.
  - `NeedInput.customerId?: string | null`, `NeedRow.customerId: string | null`.

- [ ] **Step 1: Write the failing tests** in `matching.test.ts`:
  - `a person is matched by email domain, case-insensitively`: customer `acme.com`, requester `Bob@ACME.com` → `customer.source: 'domain'`; `bob@eng.acme.com` → `customer: null`.
  - `creating a customer matches existing people and moves their past requests`: person + feedback first, then `customerCreate` → `customerNeeds { customer { id } }` is the new customer, and no `CustomerNeed` webhook was delivered for the move, and the need's `updatedAt` is unchanged.
  - `a manual pick wins over a domain` and `clearing a manual pick applies the domain again`.
  - `removing a domain unlinks its domain-matched people` (manual ones stay).
  - `changing a person's email re-matches them`.
  - `a portal sign-in creates a matched person` (through `/portal/auth/link` + confirm helper).
  - `merging people across customers gives the merged requests the kept person's customer` (Review Focus 5).
  - `merging customers moves people and requests`; `deleting a customer clears people and requests`.
  - `a request with a person refuses a different customerId` → INVALID_INPUT; `a request without a person stores the given customerId`; `customerId and customerExternalId together` → INVALID_INPUT.
  - `customerNeeds(filter: { customer: { id: { eq } } })` returns the customer's requests.
  - `requesters list filters by customerId`; `with Customers off a person's customer is null`.
  - `turning Customers on matches every person`.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/customers/__tests__/integration/matching.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `domains.ts` and the call sites; matching runs inside the writer's transaction.
- [ ] **Step 4: Run** `cd apps/api && bun run test src/customers src/feedback src/portal src/forms` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): people and requests follow their customer`

### Task 4: Customer counts

**Files:**
- Modify: `apps/api/src/feedback/store.ts`, `apps/api/src/graphql/customer-need-filter.ts`, `apps/api/src/graphql/resolvers/{issue,customer}.ts`
- Test: `apps/api/src/customers/__tests__/integration/counts.test.ts`

**Interfaces:**
- Produces: `customerCountSql(importantOnly = false): SQL<number>` correlated with the outer `issue`:
  ```sql
  CASE WHEN (SELECT customers_enabled FROM organization) THEN
    (SELECT count(DISTINCT COALESCE('c:' || n.customer_id, 'p:' || a.external_user_creator_id, 'n:' || n.id))
     FROM customer_need n LEFT JOIN attachment a ON a.id = n.attachment_id
     WHERE n.issue_id = issue.id AND n.archived_at IS NULL [AND n.priority = 1])
  ELSE <requesterCountSql(importantOnly)> END
  ```
  It replaces `requesterCountSql` in `customerCountFilter`, `customerImportantCountFilter` and the `customerCount` / `customerImportantCount` sorts. `Customer.approximateNeedCount` = count of distinct issues of the customer's active needs.

- [ ] **Step 1: Write the failing tests** in `counts.test.ts`:
  - `two people of one customer count once` (`issues(filter: { customerCount: { eq: 1 } })` finds the issue; Review Focus 2).
  - `people without a customer count each, and a request with neither counts once`.
  - `customerImportantCount counts customers with important requests`.
  - `with Customers off customerCount counts people` (same data → 2; Review Focus 4).
  - `the customerCount sort orders by customers`.
  - `approximateNeedCount counts distinct issues`.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/customers/__tests__/integration/counts.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `customerCountSql` and wire it.
- [ ] **Step 4: Run** `cd apps/api && bun run test src/customers src/feedback src/graphql` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): count customers on issues`

### Task 5: Portal boards for a customer

**Files:**
- Modify: `apps/api/src/portal/{access,boards,issues,votes,comments,session,admin,routes}.ts`, `apps/api/src/forms/public.ts`, `apps/api/src/updates/changes.ts`, `apps/api/AGENTS.md`, `packages/auth/AGENTS.md`
- Test: `apps/api/src/portal/__tests__/integration/customer-boards.test.ts`

**Interfaces:**
- Consumes: Task 3 `external_user.customer_id`.
- Produces:
  - `Visitor.customerId: string | null` (read in `visitorFromRequest` from the requester row on every request; null while Customers off).
  - `personMayRead(board, person: { email: string | null; customerId: string | null }): boolean` replaces `emailMayRead`; `canReadBoard(board, visitor)` calls it. Customer access: `board.customerId != null && person.customerId === board.customerId`.
  - `addressMayRead(board, email): Promise<boolean>` for sign-in links: public / restricted as today; customer access: the email's domain is in the board customer's domains, or the address belongs to an unmerged person linked to the customer.
  - `getBoardBySlug` and `boardsShowingIssue` leave out boards with `access = 'customer'` while Customers is off.
  - `shownSql`: `shows = 'customerRequests'` → issues with an active need whose `customer_id = board.customerId`, in public teams, status rules unchanged, labels still narrow when set. `boardsShowingIssue` also considers customer-requests boards of customers with a need on the issue.
  - Customer-access boards (both kinds): vote count = distinct people among the issue's active needs with `customer_id = board.customerId` (`voteState(issueId, requesterId, customerId?)`, the Top sort the same); `boardCommentsSql(board)` adds: the thread root's author is a member, or an external user whose current `customer_id = board.customerId`.
  - Board admin DTO / input gain `shows: 'issues' | 'customerRequests'`, `customerId: string | null`; access `customer` needs `customerId` and Customers on (400 otherwise); `customerRequests` needs access `customer`. `BoardDto.customer: { id, name } | null`.
  - `updates/changes.ts` uses `personMayRead(board, { email, customerId })`.

- [ ] **Step 1: Write the failing tests** in `customer-boards.test.ts`:
  - `only the customer's people read a customer board`: Acme person reads; Globex person and anonymous → 404.
  - `a sign-in link is sent only to the customer's addresses` (logged link for `x@acme.com`, none for `x@globex.com`; same response).
  - `a visitor loses the board on the next request when moved to another customer` and `gains it when picked by hand` (Review Focus 3); `deleting the customer makes its board not found`; `merging moves the board to the target`.
  - `with Customers off a customer board is not found and sends no link` (Review Focus 4).
  - `a customer-requests board shows only issues the customer asked for`, never a private team's, canceled hidden, done for 30 days.
  - `votes on a customer board count only that customer's people`: Acme ×2 and Globex ×1 on one issue → 2 (Review Focus 2).
  - `threads on a customer board show only the customer's people and the team`.
  - `a board cannot use customer access without a customer` (400) and `customerRequests needs customer access` (400).
  - `requester updates link a customer board only for its people`.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/portal/__tests__/integration/customer-boards.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, and update `apps/api/AGENTS.md` (Customers section, Portal boards / visitors, Feedback counts, webhook resource list) and `packages/auth/AGENTS.md` (new endpoints).
- [ ] **Step 4: Run** `cd apps/api && bun run test` — Expected: PASS except the 5 object-store attachment tests when RustFS is down.
- [ ] **Step 5: Commit** `feat(api): portal boards for a customer`

### Task 6: Settings → Workspace → Customers

**Files:**
- Create: `apps/web/src/services/customers.service.ts`, `apps/web/src/hooks/useCustomersEnabled.ts`, `apps/web/src/features/customers-settings/{CustomersSettingsPage.tsx,components/*,utils/*}`, `apps/web/src/app/settings/workspace/customers/page.tsx`
- Modify: the workspace settings nav (`apps/web/src/utils/settingsNav*` or its component), `apps/web/src/utils/paths.ts`
- Test: `apps/web/src/features/customers-settings/utils/__tests__/*.test.ts`

**Interfaces:**
- Produces:
  - `useCustomersEnabled(): boolean` (from `organization { customersEnabled }`).
  - `customers.service.ts`: `useCustomersSettings()`, `useSaveCustomersSettings()`, `useCustomerStatuses()`, `useCustomerTiers()`, status / tier create, update, delete mutations, `useCustomers(filter)`, `useCustomer(slugId)`, `useCreateCustomer()`, `useUpdateCustomer()`, `useDeleteCustomer()`, `useMergeCustomers()`, `useSetPersonCustomer()`.
  - Paths: `settingsWorkspaceCustomersPath()`, `feedbackCustomersPath()`, `feedbackCustomerPath(slugId)`.
- Page: switch ("Customers", description "Group the people who give feedback by the company they work for."), currency select (USD, EUR, GBP, CAD, AUD, JPY, CHF, SEK, NOK, DKK, PLN, INR, BRL), Statuses and Tiers lists (name, colour, description, drag order; delete with confirm; the last status has no delete). Owners and admins edit; members see it read-only.

- [ ] **Step 1: Write the failing test** for `utils/order.ts` `positionBetween(before?: number, after?: number): number` (sparse floats: `(undefined, undefined) → 1000`, `(1000, undefined) → 2000`, `(1000, 2000) → 1500`).
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/customers-settings` — Expected: FAIL.
- [ ] **Step 3: Implement** the util, services, hook and page.
- [ ] **Step 4: Run** `cd apps/web && bun test src/features/customers-settings && bun run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): customers settings`

### Task 7: Customers pages and feedback fields

**Files:**
- Create: `apps/web/src/features/customers/{CustomersPage,CustomerPage}.tsx`, `components/{CustomersList,CustomerDialog,CustomerDetails,CustomerDomains,CustomerPeople,CustomerIssues,MergeCustomerDialog}.tsx`, `utils/customers.ts`, `apps/web/src/app/feedback/customers/page.tsx`, `apps/web/src/app/feedback/customers/[slugId]/page.tsx`, `apps/web/src/features/feedback/components/PersonCustomerField.tsx`, `apps/web/src/components/common/feedback/CustomerChip.tsx`
- Modify: `components/common/page/FeedbackNav.tsx`, `components/common/feedback/{IssueFeedback,FeedbackAddDialog,FeedbackEditableItem}.tsx`, `services/feedback.service.ts`, `features/feedback/PersonPage.tsx`
- Test: `apps/web/src/features/customers/utils/__tests__/customers.test.ts`

**Interfaces:**
- Consumes: Task 6 services and hook.
- Produces:
  - `utils/customers.ts`: `sortCustomers(rows, key: 'name' | 'requests' | 'people' | 'revenue', dir)`, `formatRevenue(value: number | null, currency: string): string` (`Intl.NumberFormat` compact, `—` for null), `issuesOfCustomer(needs): { issueId, requests, important, lastAt }[]` (grouped, most requests first).
  - FeedbackNav: People, Customers (only when enabled), Reports.
  - Customers list columns: Name (logo), Status, Tier, Owner, People, Requests (`approximateNeedCount`), Revenue; search by name; New customer dialog (name, domains, status, tier, owner, revenue, size).
  - Customer page: details editable in place, domains editor (shows the API's error), people (requesters list with `customerId`), issues (from `customerNeeds(filter: { customer })`), Merge into… and Delete (confirm).
  - Person page: `PersonCustomerField` ("From email domain" / "Set by hand"; "Use email domain" clears).
  - Issue feedback items show `CustomerChip`; Add feedback dialog shows the chosen person's customer, and without a person a customer picker sending `customerId`.
  - Everything customer-related renders nothing while `useCustomersEnabled()` is false.

- [ ] **Step 1: Write the failing tests** for `sortCustomers`, `formatRevenue(1250000, 'USD') === '$1.3M'`, `formatRevenue(null, 'USD') === '—'`, `issuesOfCustomer` grouping.
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/customers` — Expected: FAIL.
- [ ] **Step 3: Implement** the utils, pages and fields.
- [ ] **Step 4: Run** `cd apps/web && bun test && bun run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): customers pages`

### Task 8: Customers in Insights and dashboards

**Files:**
- Modify: `apps/web/src/utils/requests.ts`, `services/feedback.service.ts` (`RequestRefsPage` adds `customer { id revenue }`), `utils/insights/{measures,data}.ts`, `features/insights/components/InsightsControls.tsx`, `utils/dashboards/{config,feedbackMeasures,issueMeasures,compute,loads,templates,csv}.ts`, create `utils/dashboards/customerMeasures.ts`, `services/dashboardData.service.ts`, `features/dashboards/components/{WidgetMeasureFields,WidgetCard}.tsx`
- Test: `apps/web/src/utils/dashboards/__tests__/{compute,templates,config}.test.ts`, `apps/web/src/utils/insights/__tests__/insights.test.ts`

**Interfaces:**
- Produces:
  - `RequestSummary` gains `customerKeys: string[]` (per request: `c:<customerId>`, else `p:<requesterId>`, else `n:<needId>`) and `customerRevenue: number` (sum of distinct customers' revenue).
  - Insights measures `customers` ("Customers asking") and `customerRevenue` ("Customer revenue"), offered only when Customers is on.
  - Dashboards:
    - issues measures `customers` (current, count) and `customerRevenue` (current, `revenue` unit); table columns `customers`, `customerRevenue`.
    - requests: `RequestRow` gains `customerId`, `customerKey`; measures `customers` (events); slices `customer`, `tier`, `customerStatus`; the names context gains customers, tiers and statuses.
    - data kind `customers` (`DataKind` adds it): `CustomerRow { id, slugId, name, statusId, tierId, ownerId, revenue, requests, createdAt }`, measures `customers` (current, count), `revenue` (current, revenue), `requests` (current, count); slices `status`, `tier`, `owner`; table columns `name`, `status`, `tier`, `owner`, `revenue`, `requests`, `people`; rows open `feedbackCustomerPath`.
    - `requiresCustomers(config): boolean` (any customer measure, slice or data kind); `WidgetCard` shows "Customers are off" instead of computing when it is true and Customers is off.
    - Feedback template appends `Requests by customer tier` (requests, measure `requests`, slice `tier`, chart, half) and `Top customers by requests` (customers, table, columns name / tier / requests / revenue, top 10, sorted by requests, half).
  - CSV: unit `revenue` exports the raw integer.

- [ ] **Step 1: Write the failing tests**:
  - `compute`: two requests from one customer + one from a person without a customer → `customers` measure 2 (Review Focus 2); slice `tier` groups by tier name with "No tier"; `customerRevenue` sums distinct customers once.
  - `config`: a widget with data `customers` round-trips through `parseWidget`; slice `tier` is refused for data `issues`.
  - `templates`: the Feedback template has the two new widgets and every template widget parses.
  - `requiresCustomers` true for each customer measure, slice and kind, false otherwise.
  - Insights: `measureValue('customers', issue)` counts `customerKeys` distinct.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement** the measures, loads, template widgets and the off notice.
- [ ] **Step 4: Run** `cd apps/web && bun test && bun run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): customers in insights and dashboards`

### Task 9: Customer boards in portal settings

**Files:**
- Modify: `apps/web/src/features/portal-admin/{utils/board.ts,components/PortalBoardAccessFields.tsx,components/PortalBoardSourceFields.tsx,components/PortalBoardRow.tsx,services/portalAdmin.service.ts}`
- Test: `apps/web/src/features/portal-admin/utils/__tests__/board.test.ts`

**Interfaces:**
- Consumes: Task 5 board DTO (`shows`, `customerId`, `customer`), Task 6 `useCustomers`, `useCustomersEnabled`.
- Produces:
  - Access options Public / Restricted / Customer (Customer only while enabled, with a customer picker); Shows options "Issues of a team or project" / "This customer's requests" (the second only with Customer access; it hides the team / project picker).
  - Board row shows "Customer: <name>"; a customer board whose customer was deleted shows "No customer — not visible".
  - `boardInput(form)` in `utils/board.ts` sends `shows`, `customerId`, and null team / project for `customerRequests`; `validateBoard(form): string | null` adds "Pick a customer" and "This customer's requests needs Customer access".

- [ ] **Step 1: Write the failing tests** for `validateBoard` (both new messages) and `boardInput` (customerRequests → `teamId: null, projectId: null`).
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/portal-admin` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run format:check && bun run lint && bun run typecheck && cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): customer boards in portal settings`
