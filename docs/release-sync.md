# Syncing releases from CI

A release pipeline records which issues went out in which release. A CI job tells the
instance about each deploy with Linear's `releaseSyncByAccessKey` mutation. The job
sends the commit it deployed and the issue identifiers (`ENG-12`) found in the commit
messages since the previous release.

- **Continuous pipeline:** each sync creates a completed release named after the commit
  (the first 7 characters of the SHA, unless `version` is given).
- **Scheduled pipeline:** each sync adds its issues to the open release. A release in a
  frozen stage takes no new issues, and they go to the next open release.

Issues of teams outside the pipeline, archived issues and unknown identifiers are
skipped. A sync that runs twice for the same commit adds nothing new.

## Create an access key

A workspace owner or admin creates the key in **Team settings → Releases → the pipeline
→ Access keys**. The key starts with `itpr_` and is shown once. Store it as a CI secret,
for example `RELEASE_ACCESS_KEY`. A key works only for its own pipeline and only for the
access key operations (`releaseSyncByAccessKey`, `releaseUpdateByPipelineByAccessKey`,
`releaseCompleteByAccessKey`, `latestReleaseByAccessKey`, `recentReleasesByAccessKey`,
`releasePipelineByAccessKey`). Revoking it stops it at once.

The job needs the API's GraphQL URL, for example `https://api.example.com/graphql`, as
`RELEASE_API_URL`.

## The sync script

The script below reads the commit of the pipeline's latest release, collects issue
identifiers from the commit messages since then, and syncs the current commit. It needs
`git`, `curl` and `jq`, and a checkout with enough history to reach the previous release
(`fetch-depth: 0` on GitHub Actions, `GIT_DEPTH: 0` on GitLab CI). Save it in the
repository as `scripts/release-sync.sh`.

```bash
#!/usr/bin/env bash
# release-sync.sh — run after a successful deploy.
set -euo pipefail

: "${RELEASE_API_URL:?}" "${RELEASE_ACCESS_KEY:?}"
SHA="${1:-$(git rev-parse HEAD)}"

graphql() {
  curl -fsS "$RELEASE_API_URL" \
    -H "Authorization: Bearer $RELEASE_ACCESS_KEY" \
    -H 'Content-Type: application/json' \
    --data "$1"
}

# The commits since the latest release, if this checkout has that commit; else only
# this commit (the first sync).
PREVIOUS=$(graphql '{"query":"{ latestReleaseByAccessKey { commitSha } }"}' |
  jq -r '.data.latestReleaseByAccessKey.commitSha // empty')
if [ -n "$PREVIOUS" ] && git cat-file -e "$PREVIOUS^{commit}" 2>/dev/null; then
  COMMITS=$(git rev-list "$PREVIOUS..$SHA")
else
  COMMITS="$SHA"
fi

# Each issue identifier (team key, dash, number) in those commit messages, once, with
# the newest commit that mentions it.
REFERENCES=$(for commit in $COMMITS; do
  git log -1 --format=%B "$commit" |
    grep -oE '\b[A-Z][A-Z0-9]+-[0-9]+\b' |
    sort -u |
    sed "s/\$/\t$commit/"
done | sort -s -u -t "$(printf '\t')" -k1,1 |
  jq -R -s 'split("\n") | map(select(length > 0) | split("\t") |
    { identifier: .[0], commitSha: .[1] })')

PAYLOAD=$(jq -n --arg sha "$SHA" --argjson refs "$REFERENCES" '{
  query: "mutation($input: ReleaseSyncInputBase!) { releaseSyncByAccessKey(input: $input) { success release { name version url } } }",
  variables: { input: { commitSha: $sha, issueReferences: $refs } }
}')

graphql "$PAYLOAD" | jq '.data.releaseSyncByAccessKey // .'
```

Optional fields of the input:

- `version` (for example the tag, `v2.3.0`) and `name`;
- `description`;
- `links` (`[{ url, label }]`, such as the CI run);
- `documents` (`[{ title, content }]`);
- `releaseNotes` (`{ title, content }`);
- `repository` (`{ owner, name, provider, url }`).

On a scheduled pipeline, `revertedIssueReferences` removes issues from the open release.
`preserveStoredCommitSha: true` keeps the release's stored commit when the checkout is
behind it.

## GitHub Actions

```yaml
  release-sync:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Sync the release
        env:
          RELEASE_API_URL: ${{ vars.RELEASE_API_URL }}
          RELEASE_ACCESS_KEY: ${{ secrets.RELEASE_ACCESS_KEY }}
        run: bash scripts/release-sync.sh "$GITHUB_SHA"
```

## GitLab CI

```yaml
release-sync:
  stage: .post
  needs: [deploy]
  image: alpine:3
  variables:
    GIT_DEPTH: 0
  before_script:
    - apk add --no-cache bash curl git jq
  script:
    - bash scripts/release-sync.sh "$CI_COMMIT_SHA"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

`RELEASE_API_URL` and `RELEASE_ACCESS_KEY` are CI/CD variables. Mark the key masked and
protected.

## Completing a scheduled release

A scheduled release is completed from its page, or from CI once the release is out:

```bash
graphql '{"query":"mutation { releaseCompleteByAccessKey(input: { version: \"2.3.0\" }) { release { name completedAt } } }"}'
```

Without `version` the latest started release is completed. Its unfinished issues move to
the next planned release when the pipeline rolls issues over.
