import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  listTokenRepositories,
  type ImportRepository,
  type TokenService,
} from '../services/imports.service';
import { SERVICE_LABEL } from '../utils/imports';

export interface TokenSourceForm {
  host: string;
  token: string;
  repository: string;
}

// GitLab, Gitea and Forgejo: the server's address, an access token (held in this
// form's state only, never cached), and a repository the token can read.
export default function TokenSourceFields({
  service,
  value,
  onChange,
}: {
  service: TokenService;
  value: TokenSourceForm;
  onChange: (value: TokenSourceForm) => void;
}) {
  const [repos, setRepos] = useState<ImportRepository[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<TokenSourceForm>) => onChange({ ...value, ...patch });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRepos(await listTokenRepositories(service, value.host.trim(), value.token));
    } catch (err) {
      setRepos(null);
      setError(err instanceof Error ? err.message : 'The repositories could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="import-host">{SERVICE_LABEL[service]} address</Label>
        <Input
          id="import-host"
          className="sm:w-96"
          placeholder={service === 'gitlab' ? 'https://gitlab.com' : 'https://git.example.com'}
          value={value.host}
          onChange={(e) => {
            setRepos(null);
            set({ host: e.target.value, repository: '' });
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="import-token">Access token</Label>
        <Input
          id="import-token"
          type="password"
          autoComplete="off"
          className="sm:w-96"
          value={value.token}
          onChange={(e) => {
            setRepos(null);
            set({ token: e.target.value, repository: '' });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Used for this import only and not stored. It needs read access to issues.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!value.host.trim() || !value.token || loading}
          onClick={load}
        >
          {loading ? 'Loading…' : 'Load repositories'}
        </Button>
        {repos && repos.length > 0 && (
          <Select value={value.repository} onValueChange={(repository) => set({ repository })}>
            <SelectTrigger aria-label="Repository" className="w-full sm:w-72">
              <SelectValue placeholder="Choose a repository" />
            </SelectTrigger>
            <SelectContent>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {repos?.length === 0 && (
          <span className="text-sm text-muted-foreground">
            The token cannot see any repository.
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
