# Customers (feedback project 6)

## Intent

Agencies and B2B teams hear from several people at each client. They want to weigh
requests by company (how many clients asked, how large they are, which tier) and to give
each client a portal that shows only that client's work and activity. Linear does the
first part with Customers. This project adds Linear's Customers as an optional feature
(off by default) and connects them to the portal. It is project 6 of the feedback
programme (1 feedback and requesters, 2 portal, 3 forms, 4 outbound updates, 5 reports
and dashboards, 6 Customers).

## Goals

### Turning it on

- Settings → Workspace → **Customers** (owners and admins): an on / off switch (default
  off), the revenue currency (default USD), and the lists of **statuses** and **tiers**.
- `Organization.customersEnabled` reads the switch and `customersConfiguration` holds
  `{ revenueCurrency }`. `OrganizationUpdateInput` has no field for either, so the switch
  and the currency are set through `/api/auth/instance/customers-settings`.
- While off: no customer appears in the web app or on the portal. GraphQL customer
  queries return nothing and customer mutations fail with a "Customers are not enabled"
  error. `customerCount` counts people as it does today. Boards with customer access
  answer "not found". Customer data is kept and comes back when the switch is turned on
  again (builder's call).
- Turning it on creates the default statuses **Active** (the default for new customers),
  **Prospect** and **Churned** once, and no tiers (builder's call). Statuses and tiers have
  a name, colour, description and order. The last status cannot be deleted. Deleting a
  status moves its customers to the default status, and deleting a tier clears it
  (builder's call).

### A customer (Linear's `Customer`)

- Name, email **domains**, owner (a member, not an app user), status, tier, revenue
  (whole units of the workspace currency), size, logo, external IDs and a main source ID.
  `slugId` and `url` point to the customer's page.
- Domains are stored lowercased and are unique across customers, archived ones included.
  Public email domains (gmail.com, outlook.com and similar, from a list bundled with the
  API) are refused.
- GraphQL: `customer`, `customers` (with `CustomerFilter` and sorting), `customerCreate`,
  `customerUpdate`, `customerDelete`, `customerMerge`, `customerUpsert` (by external ID),
  the `customerStatus*` and `customerTier*` queries and mutations, `Customer.needs`,
  `Customer.approximateNeedCount`, and `CustomerNeed.customer`. `customerUnsync` and the
  integration and Slack fields return null or fail as unsupported. Members and admins
  create and edit customers, and guests cannot see them (builder's call).
- `customerMerge` moves the source's needs, people and domains to the target, then
  deletes the source (builder's call: the domains must move, or the target would not
  match the source's people, and Linear keeps archived customers' domains reserved).
- Deleting a customer clears the customer from its people and needs. Deleting and
  merging are open to members and admins, as editing is.
- **No archiving** (builder's call): Linear's SDL has no customer archive mutation, so
  `Customer.archivedAt` is always null and `includeArchived` changes nothing.
- Linear's `Customer` webhook events, as `CustomerNeed` events are sent today (builder's
  call).

### Who belongs to a customer (Approach 1)

- A **person** (project 1's requester, Linear's `ExternalUser`) has at most one customer,
  stored with how it was set: **domain** or **manual**.
- **Domain:** a person whose email domain is one of a customer's domains belongs to it.
  This is applied when the person is created or their email changes, when a customer is
  created or gains a domain, and when Customers is turned on.
- **Manual:** a member picks the customer on the person's page, for someone with a
  personal address. A manual pick wins over a domain match and is kept until a member
  changes it.
- Removing a domain from a customer unlinks its domain-matched people with that domain.
  The next domain match then applies to them.
- Linear's `ExternalUser` type has no customer field, so the person's customer is read
  and set through the people endpoints of project 1.

### Which customer a request belongs to

- Each request (`CustomerNeed`) stores its customer, as Linear does.
- A request from a person takes the person's customer. When a person's customer changes,
  all their requests move with them, including past ones. This covers votes, form
  requests and feedback the team logged.
- A request without a person (team-logged feedback with no requester, or a GraphQL
  request) takes the `customerId` or `customerExternalId` it was given, which a member can
  also choose in the Add feedback dialog.
- A request with a person always has the person's customer, so the portal, the counts
  and the customer page never disagree. A GraphQL `customerId` or `customerExternalId`
  that differs from the person's customer is refused with an error saying the customer
  follows the person (builder's call: one source of truth matters more than this
  corner of Linear's API).
- Moving many requests at once (a domain match, a manual pick, a merge of customers or
  people, turning Customers on) is one database update. It sends no `CustomerNeed`
  webhooks and does not change the requests' `updatedAt`, so requester updates and
  dashboards see no change (builder's call: the requests did not change, only their
  grouping).
- Merging two people (project 1) moves the merged person's requests to the kept person,
  and they take the kept person's customer.

### Counts and reports

- `IssueFilter.customerCount` and the `customerCount` sort count distinct customers among
  an issue's active requests. Each person without a customer counts once, and each
  request with neither counts once (Linear: "Requests without a customer record each
  count separately"). `customerImportantCount` does the same over important requests.
  With Customers off, both count people as they do today.
- `Customer.approximateNeedCount` is the number of distinct issues with the customer's
  active requests, computed on read.
- **Insights** and **dashboards** (while on):
  - a **customers** measure for issues and feedback requests (the count rule above);
  - a **customer revenue** measure (the summed revenue of the distinct customers asking);
  - customer, tier and customer status slices for feedback requests;
  - a **customers** data kind, with count, revenue and requests measures sliced by
    status, tier and owner (builder's call);
  - the issue table can show customer count and customer revenue columns.
- The **Feedback** template gains "Requests by customer tier" and "Top customers by
  requests". Existing Feedback dashboards are unchanged. A widget that uses a customer
  measure says "Customers are off" while the switch is off (builder's call).

### Pages (while on)

- **Feedback → Customers** next to People and Reports: a list with name, status, tier,
  owner, people, requests and revenue, plus a search box, sorting and **New customer**.
- **Customer page:** details (editable in place), domains, people, and the issues its
  people asked for (each with request count, important count and status). Actions:
  merge into another customer and delete.
- **Person page:** a customer field (shows "from domain" or "set by hand", and can be
  changed or cleared).
- An issue's feedback list shows each request's customer, and the Add feedback dialog
  shows the person's customer.

### Portal (user's decision: both kinds of board)

- A board's **Access** gains a third option, **Customer**, next to Public and Restricted.
  It names one customer (builder's call: one, since a client gets their own board).
  Signed-in visitors whose person belongs to that customer can read it. They get there by
  domain or by a member's manual pick.
  - A sign-in link is sent to an address only when its domain is one of the customer's
    domains, or when it belongs to a person linked to the customer. The page answers the
    same either way, as restricted boards do.
  - A visitor first seen through such a sign-in is created as a person and matched by
    domain at once.
  - Access is checked on every request, as it is today. A person moved to another
    customer loses access at once.
  - When the board's customer is merged into another, the board names the target
    (builder's call: a merge says the two are one company, whose people all move to the
    target). When the customer is deleted, the board keeps Customer access with no
    customer and answers "not found" until a member picks a customer or changes its
    access; it never becomes public.
- A board **shows** either:
  - **Issues of a team or project** (today's board, optionally narrowed by labels); or
  - **This customer's requests**, only with Customer access: active issues in public
    teams that have an active request from the customer. Project 2's rules apply:
    canceled issues are hidden, completed issues show for 30 days, and private-team
    issues never show.
- On every board with Customer access (both kinds), only that customer's activity shows
  (user's decision):
  - vote counts count only the customer's requests;
  - portal threads show only those started by the customer's people;
  - visitors see the team's replies in those threads;
  - the "All comments" setting still shows the team's comments, as it does today.

  Votes and suggestions made there belong to the customer through the person's customer.
- Requester updates (project 4) use the same access rule when deciding which boards a
  person can read and link to.

## Non-goals

- Data source integrations (Intercom, Salesforce, Zendesk), the Slack channel, customer
  CSV import, requests on projects (feedback belongs to issues, project 1), customer
  fields in the MCP tool set, customer-level email summaries, and a portal board for
  several customers at once.

## Anti-goals

- One client seeing another client's people, votes, threads or vote counts on their
  board.
- Grouping people by a public email domain.
- A customer board showing private-team issues, or any customer data showing while
  Customers is off.
- Counting the same company twice because two of its people asked.

## Constraints

- Linear's SDL is never edited, and `gql.tada check` passes. Migrations are incremental.
  Follow the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.
  Web features do not import each other; shared code goes in `apps/web/src/utils`,
  `services`, `hooks` and `components/common`.

## Approaches

1. **Customer on the person and on each request (chosen by the user).** The person's
   customer decides portal access and is copied to their requests, which store it as
   Linear's API does. The cost is keeping the two in step at the domain match, a manual
   pick, a customer merge and a person merge.
2. Customer only on the person, read through it for each request. Rejected: Linear's API
   sets a customer on a single request, which could not be stored, and every count and
   filter would need the extra join.
3. Customer only on the request, as Linear does. Rejected: the portal needs to know
   whether a visitor belongs to a customer, and that would have to be worked out from
   domains, which misses people picked by hand.

## Left to the builder

Table shapes, the public-domain list, endpoint paths and payloads, how domain matching is
batched, the customer page layout within DESIGN.md, the order of the work, and the CSV
columns of the customer widgets.
