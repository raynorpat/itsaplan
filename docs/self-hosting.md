# Self-hosting with Docker

It's a Plan runs as five services from one Compose file, plus a one-shot job that creates
the storage bucket: Postgres, RustFS (S3-compatible file storage), the API, the background
worker and the web app. Postgres and RustFS run from published images; the API, worker and
web images are built from your checkout.

This guide covers a production install on one server. For local development, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements

- A Linux server with Docker Engine and the Compose plugin (`docker compose version`).
- Two public origins served over HTTPS by a reverse proxy, for example
  `https://app.example.com` (web) and `https://api.example.com` (API). The web app and the
  API must be on the **same site** (the same registrable domain), because sign-in cookies
  are `SameSite=Lax`.
- Optional: an SMTP server or a Resend API key for email.

## Quick start

1. Clone the repository and create the environment file:

   ```bash
   git clone https://github.com/croffasia/itsaplan.git
   cd itsaplan
   cp .env.example .env
   ```

2. Set the public origins in `.env`:

   ```bash
   API_URL=https://api.example.com
   APP_URL=https://app.example.com
   ```

3. Generate a value for each secret with `openssl rand -hex 32` and set it in `.env`. Use
   hex: `POSTGRES_PASSWORD` goes inside the database URL, where `/`, `+` and `=` from base64
   break it.

   | Variable                | Used for                                         |
   | ----------------------- | ------------------------------------------------ |
   | `POSTGRES_PASSWORD`     | the database password                            |
   | `BETTER_AUTH_SECRET`    | signing sessions; also derives encryption keys   |
   | `WORKER_INTERNAL_TOKEN` | the worker's calls to the API's internal routes  |
   | `S3_ACCESS_KEY_ID`      | RustFS access key (also its root user)           |
   | `S3_SECRET_ACCESS_KEY`  | RustFS secret key, at least 8 characters         |

4. Build and start the stack:

   ```bash
   docker compose up -d --build
   ```

5. Check that the API answers:

   ```bash
   curl https://api.example.com/
   # {"name":"It's a Plan api","status":"ok"}
   ```

6. Open `APP_URL` and sign in with your email address. **The first account becomes the
   workspace owner.** Until an email provider is configured, the API writes each sign-in
   link to its log instead of sending it:

   ```bash
   docker compose logs api | grep "magic link"
   ```

The API applies database migrations every time it starts, so there is no separate
migration step.

## Services and ports

| Service      | What it does                                                    | Port                 |
| ------------ | --------------------------------------------------------------- | -------------------- |
| `postgres`   | PostgreSQL 17; data in the `postgres-data` volume               | not published        |
| `minio`      | RustFS file storage; data in the `minio-data` volume            | not published        |
| `minio-init` | creates the storage bucket once, then exits                     | none                 |
| `api`        | GraphQL API, sign-in, MCP, webhooks' source, file routes        | `API_PORT` (3000)    |
| `worker`     | webhook and email delivery, cycles, auto-archive, clean-up jobs | none                 |
| `web`        | the Next.js web app                                             | `WEB_PORT` (3001)    |

Point the reverse proxy for `API_URL` at the `api` port and the one for `APP_URL` at the
`web` port. The storage service keeps the name `minio` so instances that started on MinIO
keep their data (see [Upgrading](#upgrading)).

## Configuration

[`.env.example`](../.env.example) documents every variable. The ones most installs set:

| Variable                                | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `API_URL`, `APP_URL`                    | public origins; changing `API_URL` needs a web rebuild (it is built into the browser bundle)  |
| `TRUST_PROXY`                           | `true` behind a reverse proxy that **overwrites** `X-Forwarded-For`; see below               |
| `AUDIT_COUNTRY_HEADER`                  | the proxy header with the client's country for the audit log, read only with `TRUST_PROXY=true` (`CF-IPCountry` by default)     |
| `SMTP_*` or `RESEND_API_KEY`, `EMAIL_FROM` | outgoing email: sign-in links, invites, notifications, requester updates                   |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; redirect URI `<API_URL>/api/auth/callback/google`                          |
| `APPROVED_EMAIL_DOMAINS`                | comma-separated domains whose verified addresses may join without an invite                   |
| `PASSKEY_RP_ID`                         | the web hostname for passkeys, if it differs from the `APP_URL` hostname                      |
| `COOKIE_DOMAIN`                         | only for multi-label TLDs or deep subdomains                                                 |
| `MAX_ATTACHMENT_MB`, `MAX_AVATAR_MB`, `TEAM_QUOTA_MB` | upload limits                                                                  |
| `PRIVACY_URL`, `TERMS_URL`              | legal links on the sign-in screens (built into the web bundle)                                |
| `GITHUB_IMPORT_*`                       | the GitHub issue importer; see [github-import-setup.md](github-import-setup.md)               |

### Behind a reverse proxy

Set `TRUST_PROXY=true` only when every request reaches the API through your proxy **and**
the proxy replaces any `X-Forwarded-For` header the client sent. The API takes the first
address in that header for sign-in rate limits, the portal's per-client limits and the audit
log, so a proxy that appends to the client's own header lets the client choose its address.
When clients reach the API directly, leave `TRUST_PROXY=false`.

For nginx, set the header instead of appending:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
```

### Email

Without `SMTP_*` or `RESEND_API_KEY`, nothing is emailed: sign-in links go to the API log
and invites, notifications and requester updates are not sent. SMTP wins when both are set.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The API migrates the database on start. Read [CHANGELOG.md](../CHANGELOG.md) before
upgrading across a minor version: the project is pre-1.0, and breaking changes are listed
there.

Instances from before instance settings moved to environment variables ("god mode") set
them in `.env` instead: the email provider (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_SECURE` or `RESEND_API_KEY`, and `EMAIL_FROM`), Google sign-in
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), `APPROVED_EMAIL_DOMAINS` and the upload limits
(`MAX_ATTACHMENT_MB`, `MAX_AVATAR_MB`, `TEAM_QUOTA_MB`). Passwords are no longer used:
everyone signs in with an emailed link, Google or a passkey. The other former instance
settings are on the Workspace settings page.

Instances that started on MinIO switch to RustFS on the next rebuild without copying
anything: the service keeps the name `minio` and its `minio-data` volume, and RustFS reads
MinIO's files in place with the same credentials.

## Backups

Back up the database and the file storage. The database is the source of truth; files are
attachments, avatars and imports in progress.

```bash
# Database (custom format, restore with pg_restore)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > itsaplan.dump

# Files
docker run --rm -v itsaplan_minio-data:/data -v "$PWD":/out alpine \
  tar czf /out/itsaplan-files.tgz -C /data .
```

The volume is `itsaplan_minio-data`, because `docker-compose.yml` sets the project name to
`itsaplan`. Check it with `docker volume ls`.

To restore the database into a fresh stack, start only Postgres, restore, then start the
rest:

```bash
docker compose up -d postgres
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean' < itsaplan.dump
docker compose up -d --build
```

## Deploy on Coolify

Create a **Git Based** resource for the repository with **Docker Compose** as the build pack
and `docker-compose.coolify.yml` as the compose file. Set the branch to `release` and the
commit SHA to `HEAD`. The `release` branch follows published releases only; it appears with
the first published release, and until then there is nothing to deploy from. Coolify
generates the secrets and domains through its own variables.

## Running the test gate on your server

The same check CI runs: the API test suite in a container built like production, against a
throwaway database.

```bash
docker compose -f docker-compose.test.yml build
docker compose -f docker-compose.test.yml run --rm api-test
```

It exits non-zero when any test fails.

## Troubleshooting

| Symptom                                               | Check                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Signing in loops back to the sign-in page             | `API_URL` and `APP_URL` are on the same site, served over HTTPS, and match the browser's addresses       |
| No sign-in email arrives                              | `docker compose logs api \| grep "magic link"`; set `SMTP_*` or `RESEND_API_KEY`                      |
| Uploads fail                                          | `minio-init` completed (`docker compose ps -a`); `S3_SECRET_ACCESS_KEY` has at least 8 characters        |
| The web app calls the wrong API address               | rebuild web after changing `API_URL`: `docker compose up -d --build web`                                 |
| Every client has the same IP in the audit log         | the proxy sets `X-Forwarded-For` and `TRUST_PROXY=true`                                                  |
| Webhooks are not delivered | the `worker` container is running (`docker compose logs worker`); the webhook is enabled (20 failed deliveries in a row disable it); the URL does not resolve to a private address |

## See also

- [GraphQL API](graphql-api.md)
- [Linear compared with It's a Plan](linear-comparison.md)
- [Release sync from CI](release-sync.md)
- [GitHub issue import setup](github-import-setup.md)
