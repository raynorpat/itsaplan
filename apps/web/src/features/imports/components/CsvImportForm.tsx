import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  previewCsv,
  startCsvImport,
  uploadImportFile,
  type CsvPreview,
  type CsvSourceKind,
} from '../services/csvImport.service';
import { useRefreshImports } from '../services/imports.service';
import {
  columnChoices,
  jiraHostInput,
  mappingFromChoices,
  validateColumns,
  type ColumnChoices,
  type DateFormat,
} from '../utils/csvImport';
import { destinationInput, type DestinationForm } from '../utils/imports';
import CsvColumnsFields from './CsvColumnsFields';
import CsvFileField from './CsvFileField';
import CsvJiraHostField from './CsvJiraHostField';
import CsvKindPicker from './CsvKindPicker';
import ImportDestinationFields from './ImportDestinationFields';

const EMPTY_DESTINATION: DestinationForm = {
  team: '',
  newTeamName: '',
  includeClosed: true,
  labels: '',
};

// A CSV import: a Jira export or any CSV, the file (stored as an import file and read
// back as a preview), the columns for a generic file, then the team. The import then
// waits in the list for its statuses and people.
export default function CsvImportForm() {
  const [kind, setKind] = useState<CsvSourceKind>('jira');
  const [file, setFile] = useState<{ assetUrl: string; preview: CsvPreview } | null>(null);
  const [choices, setChoices] = useState<ColumnChoices | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>('iso');
  const [destination, setDestination] = useState<DestinationForm>(EMPTY_DESTINATION);
  const [jiraHost, setJiraHost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'reading' | 'starting' | null>(null);
  const refresh = useRefreshImports();

  async function read(picked: File | undefined) {
    setFile(null);
    setError(null);
    if (!picked) return;
    setBusy('reading');
    try {
      const assetUrl = await uploadImportFile(picked);
      const preview = await previewCsv(assetUrl);
      setFile({ assetUrl, preview });
      setChoices(columnChoices(preview.guess));
      setDateFormat(preview.guess.dateFormat);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read.');
    } finally {
      setBusy(null);
    }
  }

  const notJira = kind === 'jira' && file != null && !file.preview.jira;

  async function start() {
    if (!file) return;
    const dest = destinationInput(destination);
    if ('error' in dest) return setError(dest.error);
    const columnsError = kind === 'generic' && choices ? validateColumns(choices) : null;
    if (columnsError) return setError(columnsError);
    setError(null);
    setBusy('starting');
    try {
      await startCsvImport({
        assetUrl: file.assetUrl,
        source: kind,
        mapping: kind === 'generic' && choices ? mappingFromChoices(choices, dateFormat) : null,
        destination: dest,
        jiraHostname: kind === 'jira' ? jiraHostInput(jiraHost) : undefined,
      });
      await refresh();
      setFile(null);
      setDestination(EMPTY_DESTINATION);
      setJiraHost('');
      toast.success('Import created. Match its statuses and people to start it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not start.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      <CsvKindPicker value={kind} onChange={setKind} />
      <CsvFileField
        preview={file?.preview ?? null}
        reading={busy === 'reading'}
        disabled={busy != null}
        notJira={notJira}
        onPick={(picked) => void read(picked)}
      />
      {file && kind === 'generic' && choices && (
        <CsvColumnsFields
          headers={file.preview.headers}
          sample={file.preview.sample}
          choices={choices}
          dateFormat={dateFormat}
          onChange={setChoices}
          onDateFormatChange={setDateFormat}
        />
      )}
      {file && !notJira && (
        <>
          <ImportDestinationFields value={destination} onChange={setDestination} teamOnly />
          {kind === 'jira' && (
            <CsvJiraHostField value={jiraHost} disabled={busy != null} onChange={setJiraHost} />
          )}
          <div className="flex items-center gap-3">
            <Button onClick={start} disabled={busy != null}>
              {busy === 'starting' ? 'Starting…' : 'Continue'}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </>
      )}
      {!file && error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
