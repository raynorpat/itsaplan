import Modal from '@/components/common/overlay/Modal';

const STEPS = [
  'Create an access key on the pipeline below and store it as a CI secret named RELEASE_ACCESS_KEY.',
  'Set RELEASE_API_URL to this instance’s GraphQL address, for example https://api.example.com/graphql.',
  'After each successful deploy, run the script from docs/release-sync.md, saved as scripts/release-sync.sh. It needs git, curl and jq, and enough history to reach the previous release.',
  'The script collects the issue IDs (such as ENG-12) from the commit messages since the last release and calls releaseSyncByAccessKey with them.',
  'A continuous pipeline gets one completed release per deploy. A scheduled pipeline adds the issues to its open release, which you complete from the release page.',
];

// How CI syncs releases: the steps from docs/release-sync.md, which holds the script
// and the GitHub Actions and GitLab CI jobs.
export default function ReleaseSyncHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Syncing releases from CI"
      description="Releases fill in from your deploys, with the issues their commits mention."
      onClose={onClose}
    >
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <pre className="mt-4 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
        {`# GitHub Actions, a job after the deploy
release-sync:
  needs: deploy
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Sync the release
      env:
        RELEASE_API_URL: \${{ vars.RELEASE_API_URL }}
        RELEASE_ACCESS_KEY: \${{ secrets.RELEASE_ACCESS_KEY }}
      run: bash scripts/release-sync.sh "$GITHUB_SHA"`}
      </pre>
    </Modal>
  );
}
