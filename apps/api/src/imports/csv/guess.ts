import { guessDateFormat, type DateFormat } from './dates';

// Guesses offered on the Import page, which the person can change: a column for each
// field of a generic CSV, and a workflow state for each status value of the file.

export interface ColumnMapping {
  title: number;
  description?: number;
  status?: number;
  priority?: number;
  assignee?: number;
  creator?: number;
  labels?: number;
  createdAt?: number;
  dueDate?: number;
  completedAt?: number;
  estimate?: number;
  id?: number;
  dateFormat: DateFormat;
}

export type MappedField = Exclude<keyof ColumnMapping, 'dateFormat'>;

// Header names (lowercased, spaces and punctuation as written) that point at a field,
// tried in this order of fields.
const HEADER_NAMES: [MappedField, string[]][] = [
  ['id', ['id', 'key', 'issue key', 'issue id', 'number', '#', 'ref']],
  ['title', ['title', 'summary', 'name', 'subject', 'issue', 'task']],
  ['description', ['description', 'body', 'details', 'notes', 'content']],
  ['status', ['status', 'state', 'stage', 'column']],
  ['priority', ['priority']],
  ['assignee', ['assignee', 'assigned to', 'assigned', 'owner']],
  ['creator', ['creator', 'reporter', 'author', 'created by', 'requester']],
  ['labels', ['labels', 'label', 'tags', 'tag']],
  ['createdAt', ['created', 'created at', 'created date', 'date created', 'creation date']],
  ['dueDate', ['due', 'due date', 'deadline', 'due on']],
  [
    'completedAt',
    ['completed', 'completed at', 'resolved', 'resolved at', 'closed', 'closed at', 'done date'],
  ],
  ['estimate', ['estimate', 'story points', 'points', 'size']],
];

const DATE_FIELDS: MappedField[] = ['createdAt', 'dueDate', 'completedAt'];

export function guessColumns(headers: string[], sampleRows: string[][]): ColumnMapping {
  const names = headers.map((h) => h.trim().toLowerCase());
  const used = new Set<number>();
  const found: Partial<Record<MappedField, number>> = {};
  for (const [field, candidates] of HEADER_NAMES) {
    const index = names.findIndex((n, i) => !used.has(i) && candidates.includes(n));
    if (index === -1) continue;
    found[field] = index;
    used.add(index);
  }
  const dates = DATE_FIELDS.flatMap((f) =>
    found[f] === undefined ? [] : sampleRows.map((r) => r[found[f]!] ?? ''),
  );
  const { title, ...rest } = found;
  return { ...rest, title: title ?? 0, dateFormat: guessDateFormat(dates) };
}

export interface StateOption {
  id: string;
  name: string;
  type: string;
  position: number;
}

const MEANINGS: [RegExp, string][] = [
  [
    /\b(done|closed|resolved|complete|completed|finished|fixed|shipped|released|delivered|merged|deployed)\b/,
    'completed',
  ],
  [/\b(cancel+ed|cancel|won'?t (do|fix)|wontfix|duplicate|rejected|invalid)\b/, 'canceled'],
  [/\b(in progress|progress|review|doing|started|testing|qa|in development)\b/, 'started'],
];

// The state for a status value: the state with that name (ignoring case), else the
// first state (by position) of the type the words mean, else the team's default state.
export function guessStatusState(
  value: string,
  states: StateOption[],
  defaultStateId: string,
): string {
  const text = value.trim().toLowerCase();
  if (!text) return defaultStateId;
  const byName = states.find((s) => s.name.trim().toLowerCase() === text);
  if (byName) return byName.id;
  const sorted = [...states].sort((a, b) => a.position - b.position);
  for (const [pattern, type] of MEANINGS) {
    if (!pattern.test(text)) continue;
    const state = sorted.find((s) => s.type === type);
    if (state) return state.id;
  }
  return defaultStateId;
}

const PRIORITY_WORDS: Record<string, number> = {
  'no priority': 0,
  none: 0,
  urgent: 1,
  highest: 1,
  critical: 1,
  blocker: 1,
  high: 2,
  medium: 3,
  normal: 3,
  low: 4,
  lowest: 4,
};

// Linear's priority (0 none, 1 urgent … 4 low) for a cell: Jira's and Linear's names,
// or a number 0–4. Empty is 0; anything else is null (the caller counts it and uses 0).
export function parsePriority(cell: string): number | null {
  const value = cell.trim().toLowerCase();
  if (!value) return 0;
  if (value in PRIORITY_WORDS) return PRIORITY_WORDS[value]!;
  if (/^[0-4]$/.test(value)) return +value;
  return null;
}
