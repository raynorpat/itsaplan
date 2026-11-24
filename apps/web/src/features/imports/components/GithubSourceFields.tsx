import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  useDisconnectGithubImport,
  useGithubImportStatusQuery,
  useGithubRepositoriesQuery,
} from '../services/imports.service';
import { GITHUB_STATE_KEY } from '../utils/githubCallback';

// GitHub through Linear's GitHub Import App: the instance's app must be set up, then
// connected once (installed on GitHub and authorized); the import reads the
// repositories the installation can see.
export default function GithubSourceFields({
  repoIds,
  onRepoIdsChange,
}: {
  repoIds: number[];
  onRepoIdsChange: (ids: number[]) => void;
}) {
  const status = useGithubImportStatusQuery(true);
  const connected = status.data?.integration != null;
  const repos = useGithubRepositoriesQuery(connected);
  const disconnect = useDisconnectGithubImport();

  if (status.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!status.data?.configured)
    return (
      <p className="text-sm text-muted-foreground">
        GitHub imports are not set up on this instance. Whoever runs it registers a GitHub App once,
        as described in <code className="text-xs">docs/github-import-setup.md</code>.
      </p>
    );

  if (!connected) {
    const connect = () => {
      const state = crypto.randomUUID();
      sessionStorage.setItem(GITHUB_STATE_KEY, state);
      window.location.href = `https://github.com/apps/${status.data!.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
    };
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">
          Install the GitHub Import App on the account or organization that owns the repositories,
          then pick them here.
        </p>
        <Button size="sm" onClick={connect}>
          <Github />
          Connect GitHub
        </Button>
      </div>
    );
  }

  const toggle = (id: number, on: boolean) =>
    onRepoIdsChange(on ? [...repoIds, id] : repoIds.filter((r) => r !== id));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">GitHub is connected.</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disconnect.isPending}
          onClick={() => {
            onRepoIdsChange([]);
            disconnect.mutate();
          }}
        >
          Disconnect
        </Button>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Repositories</legend>
        {repos.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {repos.isError && <p className="text-sm text-destructive">{repos.error.message}</p>}
        {repos.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            The app cannot see any repository. Add repositories to its installation on GitHub.
          </p>
        )}
        {repos.data?.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Checkbox
              id={`gh-repo-${r.id}`}
              checked={repoIds.includes(r.id)}
              onCheckedChange={(v) => toggle(r.id, v === true)}
            />
            <Label htmlFor={`gh-repo-${r.id}`}>{r.name}</Label>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
