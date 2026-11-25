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
// destination team, starting on the state the API guessed.
export interface StateChoice {
  id: string;
  name: string;
  type: string;
  position: number;
  archivedAt?: string | null;
}

// Import files are always sent as text/csv: browsers report CSVs under several types
// (or none) that the API would refuse.
export const IMPORT_CONTENT_TYPE = 'text/csv';

// The Jira site typed on the Jira form, or nothing when left empty.
export function jiraHostInput(value: string): string | undefined {
  const host = value.trim();
  return host || undefined;
}

// The states a new team gets (apps/api src/teams/store.ts DEFAULT_COLUMNS); the API
// resolves these by name once the team exists.
const NEW_TEAM_STATES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];

const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

export function statusOptions(states: StateChoice[] | null): { value: string; label: string }[] {
  if (!states) return NEW_TEAM_STATES.map((name) => ({ value: name, label: name }));
  return states
    .filter((s) => !s.archivedAt)
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

// The API's guess for each status (serviceMetadata.statusGuesses: a state id, or a
// default state name for a new team), as the step's starting choices.
export function initialStatusChoices(
  statuses: string[],
  serviceMetadata: Record<string, unknown>,
): Record<string, string> {
  const raw = serviceMetadata.statusGuesses;
  const guesses =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const status of statuses) {
    const guess = guesses[status];
    if (typeof guess === 'string' && guess) out[status] = guess;
  }
  return out;
}

export function statusMappingInput(chosen: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [value, state] of Object.entries(chosen)) if (state) out[value] = state;
  return out;
}

export const isCsvImport = (imp: { service: string }): boolean =>
  imp.service === 'jira' || imp.service === 'csv';
