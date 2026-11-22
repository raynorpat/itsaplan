# God mode to Organization settings and environment variables

Project 3 of the Linear-only app (after project 1, removing features Linear does not
have, and project 2, Linear's roles).

## Intent

God mode goes away. What Linear has moves to its `Organization`, edited by workspace
admins and owners in workspace settings and through `organizationUpdate`; instance
secrets and server limits move to environment variables; the rest is dropped.
People join the workspace the Linear way: by invite or with an email on an approved
domain. Nothing has been released.

## Goals

- A single-row `organization`, served as Linear's `Organization` and changed with
  `organizationUpdate`:
  - `name`, `urlKey`, `logoUrl`;
  - `allowedAuthServices` (`email` for password and magic link, `google`, `passkey`;
    empty means all configured services);
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

## Non-goals

- Removing password sign-in (Linear has none): `email` covers password and magic
  link sign-in for now; a later decision.
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

- **Invite:** as in project 2 (token required at sign-up).
- **Approved domain:** a sign-up whose email's domain is approved joins as a
  member, but only once the email is verified. The account is created pending
  (`user.pending_verification`): it cannot sign in, is left out of every user list,
  member and assignee picker and `userCount`, and holds no memberships; confirming
  the address clears the flag. The domain route is refused when no email provider is
  configured. Google sign-up with an approved-domain address counts as verified and
  joins at once (Google verifies addresses). Accounts that joined by invite, and
  existing accounts, are never held back (builder's call).
- **Invites through Google:** a Google sign-up whose verified email matches a
  pending invite applies that invite (role and teams); Google's verification proves
  the address, which is what the token proves for an email sign-up (builder's call).
- **Magic link** is available whenever an email provider is configured and `email`
  is allowed. The god-mode `requireEmailVerification` and `magicLink` switches go.
- **Anything else** is refused: there is no open sign-up and no "closed" mode (an
  empty approved-domain list plus no invites is closed).
- The first user of a fresh instance can always sign up and becomes the owner
  (bootstrap).
- `allowedAuthServices` limits sign-in and sign-up to the listed services,
  passkeys included (`passkey`); an existing owner can always sign in with email
  (so a misconfiguration cannot lock everyone out) (builder's call).

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
  provider set means no email (verification, invites by email and notifications
  are not sent; the approved-domain route is refused).
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

Incremental. Create `organization` with defaults: `name` from the instance's name if
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

File layout (likely `apps/api/src/organization/`), the REST route shape for the web
page, the web page layout, how the logo is uploaded (reuse the avatar upload), and
the exact better-auth hooks for the domain route.
