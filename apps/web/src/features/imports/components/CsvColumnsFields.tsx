import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CSV_FIELDS,
  DATE_FORMAT_LABEL,
  FIELD_LABEL,
  type ColumnChoices,
  type DateFormat,
} from '../utils/csvImport';

const NONE = '__none__';

// The Columns step of a generic CSV: for each field, the file column that holds it
// (prefilled with the API's guess, title required) shown with a sample value, and the
// format of the file's dates.
export default function CsvColumnsFields({
  headers,
  sample,
  choices,
  dateFormat,
  onChange,
  onDateFormatChange,
}: {
  headers: string[];
  sample: string[][];
  choices: ColumnChoices;
  dateFormat: DateFormat;
  onChange: (choices: ColumnChoices) => void;
  onDateFormatChange: (format: DateFormat) => void;
}) {
  const sampleOf = (column: number) => sample.find((row) => row[column]?.trim())?.[column] ?? '';
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Columns</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {CSV_FIELDS.map((field) => {
          const value = choices[field];
          return (
            <div key={field} className="grid gap-1">
              <Label htmlFor={`csv-${field}`} className="text-xs text-muted-foreground">
                {FIELD_LABEL[field]}
                {field === 'title' ? ' (required)' : ''}
              </Label>
              <Select
                value={value == null ? NONE : String(value)}
                onValueChange={(v) =>
                  onChange({ ...choices, [field]: v === NONE ? null : Number(v) })
                }
              >
                <SelectTrigger id={`csv-${field}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not imported</SelectItem>
                  {headers.map((header, column) => (
                    <SelectItem key={column} value={String(column)}>
                      <span className="truncate">
                        {header || `Column ${column + 1}`}
                        {sampleOf(column) && (
                          <span className="text-muted-foreground"> · {sampleOf(column)}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      <div className="grid gap-1 sm:w-72">
        <Label htmlFor="csv-date-format" className="text-xs text-muted-foreground">
          Date format
        </Label>
        <Select value={dateFormat} onValueChange={(v) => onDateFormatChange(v as DateFormat)}>
          <SelectTrigger id="csv-date-format" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATE_FORMAT_LABEL) as DateFormat[]).map((f) => (
              <SelectItem key={f} value={f}>
                {DATE_FORMAT_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </fieldset>
  );
}
