import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  startGithubImport,
  startTokenImport,
  useRefreshImports,
} from '../services/imports.service';
import type { RerunInput } from '../utils/imports';

// "Run again" on a failed import: the same source and options into the same team, so
// what already came across is skipped. A GitLab, Gitea or Forgejo import needs its
// access token again, since the token is never kept.
export default function ImportRerun({ rerun }: { rerun: RerunInput }) {
  const refresh = useRefreshImports();
  const [asking, setAsking] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (rerun.kind === 'github')
        await startGithubImport({ repoIds: rerun.repoIds, destination: rerun.destination });
      else
        await startTokenImport({
          service: rerun.service,
          host: rerun.host,
          token,
          repository: rerun.repository,
          destination: rerun.destination,
        });
      setToken('');
      setAsking(false);
      await refresh();
      toast.success('Import started again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not start.');
    } finally {
      setBusy(false);
    }
  }

  if (rerun.kind === 'token' && asking)
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void run();
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          aria-label="Access token"
          placeholder="Access token"
          className="h-8 w-56"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoFocus
        />
        <Button type="submit" size="sm" disabled={busy || !token.trim()}>
          {busy ? 'Starting…' : 'Run again'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setAsking(false);
            setToken('');
          }}
        >
          Cancel
        </Button>
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </form>
    );

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => (rerun.kind === 'token' ? setAsking(true) : void run())}
      >
        {busy ? 'Starting…' : 'Run again'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
