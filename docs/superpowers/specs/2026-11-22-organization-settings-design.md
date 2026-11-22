# God mode to Organization settings and environment variables

Project 3 of the Linear-only app (after project 1, removing features Linear does not
have, and project 2, Linear's roles).

## Intent

God mode goes away. What Linear has moves to its `Organization`, edited by workspace
admins and owners in workspace settings and through `organizationUpdate`; instance
secrets and server limits move to environment variables; the rest is dropped.
People join the workspace the Linear way: by invite or with an email on an approved
domain. Passwords go too: like Linear, people sign in with an emailed magic link,
Google or a passkey. Nothing has been released.

## Goals

- A single-row `organization`, served as Linear's `Organization` and changed with
  `organizationUpdate`:
  - `name`, `urlKey`, `logoUrl`;
  - `allowedAuthServices` (`email` for magic link, `google`, `passkey`; empty means
    all configured services);
  - `allowedFileUploadContentTypes`;
  - who may create teams, manage labels and invite: stored as the minimum role for
    each (`owner`, `admin` or `member`), written through Linear's
    `securitySettings.teamCreationRole`, `labelManagementRole` and `invitationsRole`
    (`UserRoleType`; `user` means member; `guest` and `app` are INVALID_INPUT), and
    read back there and as the deprecated booleans `restrictTeamCreationToAdmins`,
    `restrictLabelManagementToAdmins` (true when the minimum is above member) and
    `allowMembersToInvite` (true when the minimum is member) (builder's call);
  - approved email domains are read-only here: they come from the environment
    variable `APPROVED_EMAIL_DOMAINS` (Linear's public schema cannot write domains:
    there is no `organizationDomainCreate`, and `OrganizationAuthSettingsInput` takes
    only `allowedAuthServices` and two flags). They are shown in workspace settings.
- Environment variables for the email provider (SMTP or Resend), Google sign-in
  credentials, the approved email domains, and the upload limits (max attachment
  size, max avatar size, team quota).
- A "Workspace settings" web page for admins and owners (REST until project 5), with
  a read-only "Version" line.
- God mode removed: API folder, `/god/*` routes, web pages and navigation, the
  `app_setting` / `app_secret` rows it used and any code that only it used.
- Passwords removed: better-auth `emailAndPassword` is turned off, stored password
  credentials are deleted, and the web's password sign-in, sign-up, change-password,
  forgot/reset-password and email-verification screens go. Sign-in and sign-up are
  "enter your email, click the link", Google, or a passkey (passkeys are added from
  account settings once signed in).

## Non-goals

- SAML, SCIM, domain verification by DNS, billing, the other `Organization` fields
  (they keep their neutral values; `organizationUpdate` input fields for them are
  INVALID_INPUT naming the field).
- Per-user keyboard shortcuts (user preferences stay as they are).

## Anti-goals

- Anyone joining the workspace without an invite or an approved-domain email that
  has been verified.
- An admin changing instance secrets (they are environment variables now).
- An instance that cannot send email or sign in with Google because a setting the
  operator used to set in god mode was dropped without an environment variable.
- A workspace nobody can sign in to (no provider, no Google, no passkey): the
  logged magic link always works for an owner.
- A member or guest changing organization settings.

## Approaches

1. **Single-row `organization` table with typed columns (chosen).** Typed, validated
   settings; `organizationUpdate` maps onto columns.
2. **Keep `app_setting` key/value rows behind an Organization view.** Rejected:
   untyped JSON read in several places, as god mode does today.
3. **Everything in environment variables.** Rejected: admins could change nothing
   without a restart, and `organizationUpdate` would do nothing.

## Rules

### Joining the workspace

- **Magic link is how an email account is created and signed in to.** Requesting a
  link for an address with no account sends a sign-up link only when the address may
  join (a pending invite or an approved domain, or the first user of a fresh
  instance); the account is created when the link is used, so every email account
  has a proven address. Otherwise the request answers the same as for an unknown
  address and sends nothing (no account enumeration).
- **Invite:** a new account whose proven address (magic link or Google) matches a
  pending invite takes the invite's role and teams; the invite link pre-fills the
  email. The project 2 invite-token check becomes unnecessary and goes.
- **Approved domain:** a new account whose proven address (magic link or Google) is
  on an approved domain joins as a member.
- **No email provider configured:** the API writes each magic link to its log
  instead of sending it (marked as such), so an operator can sign in the first
  owner and anyone else before email is set up; the web says the link was "sent"
  either way. Invitations and notifications are not emailed without a provider.
- The god-mode `requireEmailVerification`, `magicLink` and registration settings go.
- **Anything else** is refused: there is no open sign-up and no "closed" mode (an
  empty approved-domain list plus no invites is closed).
- The first user of a fresh instance can always sign up and becomes the owner
  (bootstrap).
- `allowedAuthServices` limits sign-in and sign-up to the listed services,
  passkeys included (`passkey`); an existing owner can always sign in with a magic
  link (so a misconfiguration cannot lock everyone out) (builder's call).

### Who may change what

- Owners and admins: every organization setting, including allowed auth services.
  Approved domains change only through the environment.
- The three switches change the role table of project 2:
  `restrictTeamCreationToAdmins` → only admins and owners create teams;
  `restrictLabelManagementToAdmins` → only admins and owners manage workspace
  labels, project labels and project statuses; `allowMembersToInvite = false` →
  only admins and owners invite. Defaults keep project 2's behaviour (members may
  create teams, manage labels and invite).

### Environment variables

- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`
  (`tls` / `starttls` / `none`) or `RESEND_API_KEY`; `EMAIL_FROM` (existing). No
  provider set means magic links go to the API log and nothing else is emailed.
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; unset means Google sign-in is
  unavailable whatever `allowedAuthServices` says.
- Approved domains: `APPROVED_EMAIL_DOMAINS`, a comma-separated list of domains
  (case ignored, surrounding spaces ignored); unset or empty means none.
- Uploads: `MAX_ATTACHMENT_MB` (default 25), `MAX_AVATAR_MB` (default 5),
  `TEAM_QUOTA_MB` (default 51200, 0 = unlimited).
- All in `.env.example` and both deploy compose files.

### Dropped

- Instance keyboard shortcuts (users fall back to the built-in defaults; their own
  preferences stay).
- Update status and "check for updates" (`settings/updates.ts` and any worker job);
  the running version stays readable (`GET /version` or the existing route) and is
  shown read-only on workspace settings.
- God-mode user list, user detail, "confirm email" and hard delete (workspace members
  page and suspension cover users; Linear has no hard delete); god-mode team list and
  detail (Browse teams and team settings cover teams).

### Migration

Incremental. Delete password credentials (better-auth `account` rows with provider
`credential`). Create `organization` with defaults: `name` from the instance's name if
one is stored, else "Workspace"; `urlKey` derived from the name;
`allowedFileUploadContentTypes` from the stored storage settings. Drop the god-mode `app_setting` / `app_secret` rows. An operator who used
god mode for email or Google must set the environment variables (called out in the
README upgrade note).

## GraphQL

- `organization` returns the row with `userCount`, `createdIssueCount`, `teams`,
  `users`, `labels`, `projectLabels`, `projectStatuses` (existing resolvers reused,
  each with its project 2 visibility).
- `organizationUpdate(input)`: the fields above; guests and members → FORBIDDEN.
- `organizationDomainDelete` stays NOT_IMPLEMENTED (domains come from the
  environment).

## Left to the builder

File layout (likely `apps/api/src/organization/`), how the API tests sign users in
without passwords (a test helper that creates the user and session directly, or
consumes a captured magic link), the REST route shape for the web page, the web page layout, how the logo is uploaded (reuse the avatar upload), and
the exact better-auth hooks for the domain route.
