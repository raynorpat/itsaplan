import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CsvPreview } from '../services/csvImport.service';

// The CSV file input, with what was read from it (rows and columns) and the warning for
// a file chosen as a Jira export that has no Summary column.
export default function CsvFileField({
  preview,
  reading,
  disabled,
  notJira,
  onPick,
}: {
  preview: CsvPreview | null;
  reading: boolean;
  disabled: boolean;
  notJira: boolean;
  onPick: (file: File | undefined) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="csv-file">CSV file</Label>
      <Input
        id="csv-file"
        type="file"
        accept=".csv,text/csv"
        className="sm:w-96"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {reading && <p className="text-xs text-muted-foreground">Reading the file…</p>}
      {preview && (
        <p className="text-xs text-muted-foreground">
          {preview.rows} {preview.rows === 1 ? 'row' : 'rows'}, {preview.headers.length} columns
        </p>
      )}
      {notJira && (
        <p className="text-sm text-destructive">
          The file is not a Jira CSV export (no Summary column). Choose Other CSV to map its
          columns.
        </p>
      )}
    </div>
  );
}
