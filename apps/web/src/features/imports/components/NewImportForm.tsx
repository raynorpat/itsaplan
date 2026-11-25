import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  startGithubImport,
  startTokenImport,
  useRefreshImports,
} from '../services/imports.service';
import { destinationInput, type DestinationForm, type ImportSource } from '../utils/imports';
import ImportSourcePicker from './ImportSourcePicker';
import GithubSourceFields from './GithubSourceFields';
import TokenSourceFields, { type TokenSourceForm } from './TokenSourceFields';
import ImportDestinationFields from './ImportDestinationFields';
import CsvImportForm from './CsvImportForm';

const EMPTY_DESTINATION: DestinationForm = {
  team: '',
  newTeamName: '',
  includeClosed: true,
  labels: '',
};

const hostFor = (service: ImportSource) => (service === 'gitlab' ? 'https://gitlab.com' : '');

// Starts an import: the source, then the team and filters. The import fetches in the
// background and then waits in the list below for the people matching.
export default function NewImportForm() {
  const [service, setService] = useState<ImportSource>('github');
  const [repoIds, setRepoIds] = useState<number[]>([]);
  const [source, setSource] = useState<TokenSourceForm>({ host: '', token: '', repository: '' });
  const [destination, setDestination] = useState<DestinationForm>(EMPTY_DESTINATION);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const refresh = useRefreshImports();

  function pick(next: ImportSource) {
    setService(next);
    setRepoIds([]);
    setSource({ host: hostFor(next), token: '', repository: '' });
    setError(null);
  }

  const sourceReady = service === 'github' ? repoIds.length > 0 : source.repository !== '';

  async function start() {
    const dest = destinationInput(destination);
    if ('error' in dest) {
      setError(dest.error);
      return;
    }
    setError(null);
    setStarting(true);
    try {
      if (service === 'github') {
        await startGithubImport({ repoIds, destination: dest });
        setRepoIds([]);
      } else if (service !== 'csv') {
        await startTokenImport({
          service,
          host: source.host.trim(),
          token: source.token,
          repository: source.repository,
          destination: dest,
        });
      }
      await refresh();
      // The token leaves the page's state once the import has it.
      setSource({ host: source.host, token: '', repository: '' });
      setDestination(EMPTY_DESTINATION);
      toast.success('Import started. Its issues are being fetched.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not start.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <ImportSourcePicker value={service} onChange={pick} />
      {service === 'csv' ? (
        <CsvImportForm />
      ) : service === 'github' ? (
        <GithubSourceFields repoIds={repoIds} onRepoIdsChange={setRepoIds} />
      ) : (
        <TokenSourceFields key={service} service={service} value={source} onChange={setSource} />
      )}
      {service !== 'csv' && sourceReady && (
        <>
          <ImportDestinationFields value={destination} onChange={setDestination} />
          <div className="flex items-center gap-3">
            <Button onClick={start} disabled={starting}>
              {starting ? 'Starting…' : 'Start import'}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
