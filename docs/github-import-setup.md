# Setting up GitHub issue imports

GitHub imports (Settings → Workspace → Import → GitHub) read issues through a GitHub
App that belongs to this instance, as Linear's GitHub Import App does for Linear. The
app is registered once per instance; a workspace admin then connects it and picks
repositories. GitLab, Gitea and Forgejo imports use a pasted access token and need no
setup.

## 1. Register the GitHub App

On GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App** (for
an organization: the organization's settings, same path).

- **GitHub App name:** any name, for example "Its a Plan import". Its URL slug (shown
  after creating it, `https://github.com/apps/<slug>`) is `GITHUB_IMPORT_APP_SLUG`.
- **Homepage URL:** the web address of the instance (`APP_URL`).
- **Callback URL:** `<APP_URL>/settings/workspace/import/github/callback`.
- **Request user authorization (OAuth) during installation:** on. The instance
  checks, with that authorization, that the person connecting can access the
  installation.
- **Setup URL:** leave empty (with the option above, GitHub uses the callback URL).
- **Webhook:** off. Imports are one-time; the instance needs no events.
- **Repository permissions:** **Issues: Read-only** and **Metadata: Read-only**.
  Nothing else.
- **Where can this GitHub App be installed?** "Only on this account" when every
  repository to import is in one account or organization; "Any account" otherwise.

Create the app.

## 2. Collect its credentials

On the app's settings page:

- **App ID** → `GITHUB_IMPORT_APP_ID`.
- **Client ID** → `GITHUB_IMPORT_CLIENT_ID`.
- **Generate a new client secret** → `GITHUB_IMPORT_CLIENT_SECRET`.
- **Generate a private key** (downloads a `.pem` file) → `GITHUB_IMPORT_PRIVATE_KEY`.
  In an env file, put the key on one line with each newline written as `\n`:

  ```bash
  awk 'BEGIN{ORS="\\n"} {print}' your-app.private-key.pem
  ```

## 3. Configure the instance

Set the five variables in the API's environment (`.env`, or the deploy compose
environment; both compose files pass them to the API) and restart the API:

```bash
GITHUB_IMPORT_APP_ID=123456
GITHUB_IMPORT_APP_SLUG=its-a-plan-import
GITHUB_IMPORT_CLIENT_ID=Iv1.0123456789abcdef
GITHUB_IMPORT_CLIENT_SECRET=...
GITHUB_IMPORT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n
```

Without them, the Import page says "GitHub imports are not set up on this instance".

## 4. Connect and import

A workspace owner or admin opens Settings → Workspace → Import, chooses GitHub and
**Connect GitHub**. GitHub asks where to install the app and which repositories it may
read, then returns to the instance, which stores the installation (no GitHub token is
stored; the instance mints short-lived installation tokens from the app's key when it
reads). The repositories the installation can see are then offered for import.

github.com only: GitHub Enterprise Server is not supported.
