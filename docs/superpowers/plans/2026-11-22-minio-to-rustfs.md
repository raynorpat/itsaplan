# MinIO to RustFS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run RustFS instead of MinIO as the object store in every compose file, because the MinIO community images are no longer published. Existing deployments upgrade in place with no data copy.

**Architecture:** The application reaches the object store only through `apps/api/src/shared/s3.ts` (AWS SDK v3, `forcePathStyle: true`, `S3_*` env). RustFS serves the same S3 API on `:9000`, so no application code changes. In the compose files, the `minio` service swaps its image to `rustfs/rustfs`, and the `minio-init` one-shot swaps `mc` for a `curl` SigV4 `PUT` from the RustFS image. RustFS reads the files MinIO wrote, so the deploy stacks keep the `minio` service name, the `minio-data` volume, and the credentials, and run the container as root because MinIO wrote the files as root.

This ports upstream commit `croffasia/itsaplan@e063a15` ("feat: replace MinIO with RustFS for attachment storage", #437) to this fork's file layout.

**Tech Stack:** Docker Compose, RustFS 1.0.0, curl (`--aws-sigv4`).

**Spec:** none. The requirement is the user's request to move from MinIO to RustFS, following the upstream commit.

## Global Constraints

- Agents do not commit (root `AGENTS.md`). Each task ends with a proposed Conventional Commit message for the user.
- A deploy-stack change lands in both `docker-compose.yml` and `docker-compose.coolify.yml`.
- Image: `rustfs/rustfs:1.0.0` everywhere (store and init), same as upstream.
- Keep the `S3_*` variable names and the default keys (`minioadmin`). They are credentials values, not product references; changing them would break existing `.env` files.
- In `docker-compose.dev.yml`, `docker-compose.yml`, and `docker-compose.coolify.yml`: keep the service name `minio`, the service name `minio-init`, the volume names (`minio-dev-data`, `minio-data`), and the Coolify variables `SERVICE_USER_MINIO` / `SERVICE_PASSWORD_MINIO`. A renamed service leaves the old MinIO container running on the same volume; a renamed volume starts empty; renamed Coolify credentials are generated anew. Each file states this once in a comment, as upstream does.
- `docker-compose.test.yml` is throwaway (tmpfs), so it renames to `rustfs-test` / `rustfs-test-init`.

## Out of scope (keep as is)

- `apps/api/src/shared/s3.ts` logic. Only its comment changes.
- `S3_ENDPOINT` values (`http://minio:9000` in the deploy stacks, `http://localhost:9000` in `.env`). The service name is unchanged.
- Historical plan/spec docs under `docs/superpowers/`.

## Branching

Branch from `main`: `chore/rustfs`. It touches no file that `feat/linear-stage8` changes.

## Review Focus

1. The `minio` service in the dev, self-host, and Coolify stacks keeps its service name, volume, and credential variables. Only the image, `user`, env var names, `command` (removed), and healthcheck change.
2. `minio-init` waits on `minio: condition: service_healthy`, and keeps `restart: 'no'` in `docker-compose.yml` and `docker-compose.coolify.yml`.
3. The init `curl` uses `-f`, so a failed PUT exits non-zero and the api's `service_completed_successfully` dependency fails visibly.
4. The test RustFS mounts `/data` tmpfs with `uid=10001,gid=10001` (RustFS's default non-root user); it does not set `user: '0:0'`.
5. No published S3 or console port in `docker-compose.yml` or `docker-compose.coolify.yml`.

---

## Task 1: Dev compose

**Files:** `docker-compose.dev.yml`

- [ ] **Step 1:** Replace the `minio` service body:

```yaml
  # S3-compatible object store for issue attachments (RustFS).
  # The attachments bucket is created by the minio-init service below.
  #   S3 API:      http://localhost:9000
  #   Web console: http://localhost:9001/rustfs/console/
  #     login with S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY from .env
  #
  # The service and volume keep their MinIO-era names so an existing dev stack
  # upgrades in place: RustFS reads the files MinIO wrote, and runs as root because
  # MinIO wrote them as root.
  minio:
    image: rustfs/rustfs:1.0.0
    restart: unless-stopped
    user: '0:0'
    environment:
      RUSTFS_ACCESS_KEY: ${S3_ACCESS_KEY_ID:-minioadmin}
      RUSTFS_SECRET_KEY: ${S3_SECRET_ACCESS_KEY:-minioadmin}
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - minio-dev-data:/data
    healthcheck:
      test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:9000/health']
      interval: 5s
      timeout: 5s
      retries: 10
```

- [ ] **Step 2:** Replace `minio-init`:

```yaml
  # One-shot: creates the attachments bucket, then exits. A PUT on a bucket that
  # already exists succeeds, so it runs on every start.
  minio-init:
    image: rustfs/rustfs:1.0.0
    depends_on:
      minio:
        condition: service_healthy
    environment:
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:-minioadmin}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-minioadmin}
      S3_BUCKET: ${S3_BUCKET:-planner-attachments}
    entrypoint: >
      /bin/sh -c "
      curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user \"$$S3_ACCESS_KEY_ID:$$S3_SECRET_ACCESS_KEY\" http://minio:9000/\"$$S3_BUCKET\" &&
      echo 'bucket ready: '\"$$S3_BUCKET\"
      "
```

- [ ] **Step 3:** Header comment: "Postgres and RustFS"; `# starts postgres + rustfs (+ bucket init)`.
- [ ] **Step 4: Run (in-place upgrade check):** with an existing MinIO dev volume that holds uploaded files (start `main`'s dev compose and upload an attachment first if there is none), run `docker compose -f docker-compose.dev.yml up -d`. Expected: `minio` becomes healthy, `minio-init` logs `bucket ready: planner-attachments` and exits 0, and the previously uploaded attachment still downloads in the app. Run `up -d` again; expected: `minio-init` exits 0 again.
- [ ] **Step 5: Run:** `cd apps/api && bun test src/attachments src/agent-skills`. Expected: PASS.

## Task 2: Self-hosting and Coolify compose

**Files:** `docker-compose.yml`, `docker-compose.coolify.yml`

- [ ] **Step 1:** Apply the Task 1 shapes to `minio` and `minio-init` in both files, with these differences:
  - No `ports` on `minio`. Comment: "Administer through an S3 client from inside the network or an SSH tunnel."
  - Healthcheck: `interval: 15s`, `timeout: 5s`, `retries: 5`, `start_period: 20s`.
  - `minio-init` keeps `restart: 'no'` (and in Coolify, the comment explaining why).
  - Credentials: `docker-compose.yml` uses `${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID in .env}` / `${S3_SECRET_ACCESS_KEY:?...}` on `minio` and plain `${S3_ACCESS_KEY_ID}` / `${S3_SECRET_ACCESS_KEY}` on `minio-init`. Coolify uses `${SERVICE_USER_MINIO}` / `${SERVICE_PASSWORD_MINIO}` on both.
  - The name-keeping comment names the volume and, in Coolify, the `SERVICE_*_MINIO` credentials (see upstream wording).
- [ ] **Step 2:** Header comments: `postgres + rustfs + api + worker + bot + web`. Leave the api's `S3_ENDPOINT: http://minio:9000` and `depends_on` as they are.
- [ ] **Step 3: Run:** `docker compose -f docker-compose.yml config > /dev/null` and the same for `docker-compose.coolify.yml`, with a filled `.env`. Expected: no error. Then `docker compose up -d --build` on a stack that previously ran MinIO with uploaded files; expected: old attachments and avatars still download, new uploads work.

## Task 3: Test compose and CI comments

**Files:** `docker-compose.test.yml`, `.github/workflows/ci.yml`, `AGENTS.md`

- [ ] **Step 1:** Replace `minio-test` / `minio-test-init`:

```yaml
  # Throwaway RustFS for the attachments feature test (object bytes). Ephemeral:
  # /data is tmpfs, wiped when the run ends.
  rustfs-test:
    image: rustfs/rustfs:1.0.0
    environment:
      RUSTFS_ACCESS_KEY: minioadmin
      RUSTFS_SECRET_KEY: minioadmin
    tmpfs:
      - /data:uid=10001,gid=10001
    healthcheck:
      test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:9000/health']
      interval: 3s
      timeout: 3s
      retries: 20

  # One-shot: creates the attachments bucket, then exits.
  rustfs-test-init:
    image: rustfs/rustfs:1.0.0
    depends_on:
      rustfs-test:
        condition: service_healthy
    entrypoint: >
      sh -c "
      curl -fsS -X PUT --aws-sigv4 aws:amz:us-east-1:s3 --user minioadmin:minioadmin http://rustfs-test:9000/planner-attachments &&
      echo 'bucket ready'
      "
```

- [ ] **Step 2:** `api-test`: `depends_on.rustfs-test-init: service_completed_successfully`; `S3_ENDPOINT: http://rustfs-test:9000`; comment "throwaway RustFS above". Check the worker test service for a `minio-test` reference and update it the same way.
- [ ] **Step 3:** `.github/workflows/ci.yml` comments (~lines 81–90): MinIO → RustFS, `minio-test-init` → `rustfs-test-init`. Root `AGENTS.md`: First run comment, compose table, Test gate paragraph (`rustfs-test-init`).
- [ ] **Step 4: Run:**

```bash
docker compose -f docker-compose.test.yml build
docker compose -f docker-compose.test.yml run --rm api-test
```

Expected: exit 0; attachments and agent-skills suites pass.

## Task 4: Env examples, comments, docs

**Files:** `.env.example`, `.env.test.example`, `apps/api/src/shared/s3.ts`, `apps/web/src/features/account/services/profile.service.ts`, `apps/api/src/attachments/__tests__/integration/attachments.test.ts`, `apps/api/src/agent-skills/__tests__/integration/agent-skills.test.ts`, `apps/api/AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`

- [ ] **Step 1:** `.env.example`: section title `S3 object store: RustFS`; "The keys double as RustFS root credentials"; region comment "ignored by RustFS". Keep `inside compose: http://minio:9000` and the `minioadmin` defaults. `.env.test.example`: "(RustFS)", "The local dev RustFS from docker-compose.dev.yml serves this; its minio-init creates the bucket."
- [ ] **Step 2:** `s3.ts` comment: "S3-compatible object store (RustFS in the Compose stacks)"; "forcePathStyle is required for RustFS (and most self-hosted S3 gateways)"; "region is sent but ignored by RustFS". No code change.
- [ ] **Step 3:** MinIO → RustFS in the two test-file comments, `profile.service.ts`, `apps/api/AGENTS.md` (Tests section; the gate starts "its own throwaway RustFS"), `README.md` (~lines 92, 118–119, 160, 179), `CONTRIBUTING.md` (~line 32; line 41 becomes "RustFS console `:9001/rustfs/console/`"), `SECURITY.md` (~line 47).
- [ ] **Step 4:** `README.md` self-hosting section: add the upgrade paragraph from upstream `docs/self-hosting.md`:

  > Attachments are stored in RustFS. An instance set up with MinIO switches to it on the next `docker compose up -d`: the `minio` service keeps its name and its `minio-data` volume, and RustFS reads the files MinIO wrote in place, with the same credentials. Nothing is copied, and the files stay readable by MinIO. The upgrade touches no attachment data, but a copy of the volume before it costs one command:
  >
  > `docker run --rm -v itsaplan_minio-data:/data -v "$PWD":/out alpine tar czf /out/minio-data.tgz -C /data .`

  Check the volume prefix against this fork's compose project name before writing it.
- [ ] **Step 5: Run:** `grep -rniI minio --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude=bun.lock . | grep -v docs/superpowers/`. Expected: only the kept service/volume/credential names, `S3_ENDPOINT` values, `minioadmin` defaults, and the upgrade paragraph. Then `bun run format:check`, `bun run lint`, `bun run typecheck`. Expected: pass.

## Task 5: Finish

- [ ] **Step 1:** Run `tidy`, then `code-review` on the branch diff (root `AGENTS.md`).
- [ ] **Step 2:** Proposed PR title / commit (matches upstream; not breaking, since existing deployments upgrade in place):

```
feat: replace MinIO with RustFS for attachment storage
```
