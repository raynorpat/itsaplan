// CSV imports (Jira exports and generic CSVs) on the Import page: the column mapping a
// generic file needs, and the status step every CSV import has before the people step.
// The API's answers are described in apps/api/src/imports/csv (preview, create,
// process with `statuses`).

export type DateFormat = 'iso' | 'dayFirst' | 'monthFirst';

export const CSV_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'assignee',
  'creator',
  'labels',
  'createdAt',
  'dueDate',
  'completedAt',
  'estimate',
  'id',
] as const;

export type CsvField = (typeof CSV_FIELDS)[number];

export const FIELD_LABEL: Record<CsvField, string> = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  creator: 'Creator',
  labels: 'Labels',
  createdAt: 'Created date',
  dueDate: 'Due date',
  completedAt: 'Completed date',
  estimate: 'Estimate',
  id: 'ID',
};

export const DATE_FORMAT_LABEL: Record<DateFormat, string> = {
  iso: 'ISO (2026-04-03)',
  dayFirst: 'Day first (03/04/2026)',
  monthFirst: 'Month first (04/03/2026)',
};

// The API's mapping: a 0-based column number per field, null or absent for unmapped.
export type ColumnMapping = { dateFormat: DateFormat } & Partial<Record<CsvField, number | null>>;

// What the Columns step edits: one column (or none) per field.
export type ColumnChoices = Record<CsvField, number | null>;

export function columnChoices(mapping: ColumnMapping): ColumnChoices {
  const out = {} as ColumnChoices;
  for (const field of CSV_FIELDS) {
    const column = mapping[field];
    out[field] = typeof column === 'number' ? column : null;
  }
  return out;
}

export function validateColumns(choices: ColumnChoices): string | null {
  if (choices.title == null) return 'Choose the column that holds the title';
  const used = CSV_FIELDS.map((f) => choices[f]).filter((c): c is number => c != null);
  if (new Set(used).size !== used.length) return 'Each column can be used once';
  return null;
}

// The request body's mapping: mapped fields only, plus the date format.
export function mappingFromChoices(choices: ColumnChoices, dateFormat: DateFormat): ColumnMapping {
  const out: ColumnMapping = { dateFormat };
  for (const field of CSV_FIELDS) {
    const column = choices[field];
    if (column != null) out[field] = column;
  }
  return out;
}

// The statuses step: each distinct status value in the file, mapped to a state of the
// destination team. "Automatic" leaves the value to the API's guess.
export const AUTO_STATE = '__auto__';

export interface StateChoice {
  id: string;
  name: string;
  type: string;
  position: number;
}

// The states a new team gets (apps/api src/teams/store.ts DEFAULT_COLUMNS); the API
// resolves these by name once the team exists.
const NEW_TEAM_STATES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];

const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

export function statusOptions(states: StateChoice[] | null): { value: string; label: string }[] {
  if (!states) return NEW_TEAM_STATES.map((name) => ({ value: name, label: name }));
  return [...states]
    .sort(
      (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.position - b.position,
    )
    .map((s) => ({ value: s.id, label: s.name }));
}

export function statusValues(serviceMetadata: Record<string, unknown>): string[] {
  const raw = serviceMetadata.statuses;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s !== '');
}

export function statusMappingInput(chosen: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [value, state] of Object.entries(chosen)) if (state !== AUTO_STATE) out[value] = state;
  return out;
}

export const isCsvImport = (imp: { service: string }): boolean =>
  imp.service === 'jira' || imp.service === 'csv';
