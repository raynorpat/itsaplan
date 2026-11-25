import type { SourceData, SourcePerson } from '../types';

// What a CSV reader (jira.ts, generic.ts) gives the import: the issues, the distinct
// status values in the order they first appear (the Statuses step), the rows skipped
// with their row number in the spreadsheet (the header is row 1), and counts of values
// that did not read and were left empty (dates, priorities, estimates) or, for the
// created date, replaced by the import time.
export interface CsvSource {
  data: SourceData;
  statuses: string[];
  skipped: { row: number; reason: string }[];
  counts: { badDates: number; missingCreated: number; badPriority: number; badEstimate: number };
}

export const emptyCounts = (): CsvSource['counts'] => ({
  badDates: 0,
  missingCreated: 0,
  badPriority: 0,
  badEstimate: 0,
});

// A spreadsheet row number: data row `index` (0-based) after the header row.
export const rowNumber = (index: number): number => index + 2;

// Who a cell names. An address is keyed by its lowercased email, anything else by its
// lowercased text, so the same person in several rows is one entry in the people step.
export function personFor(text: string | undefined): SourcePerson | null {
  const value = text?.trim();
  if (!value) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return { key: `email:${value.toLowerCase()}`, login: value, name: null, email: value };
  return { key: `name:${value.toLowerCase()}`, login: value, name: value, email: null };
}

// The author of a row that names no creator. It goes through the people step like any
// other person and usually stays unmatched.
export const UNKNOWN_PERSON: SourcePerson = {
  key: 'unknown',
  login: 'Unknown',
  name: null,
  email: null,
};

// Label names, trimmed, each once (ignoring case), in order.
export function uniqueLabels(names: string[]): { name: string; color: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; color: string | null }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, color: null });
  }
  return out;
}

// An estimate cell: empty is null; a number is kept; anything else is null and counted.
export function readEstimate(cell: string, counts: CsvSource['counts']): number | null {
  const value = cell.trim();
  if (!value) return null;
  const n = Number(value.replace(',', '.'));
  if (Number.isFinite(n)) return n;
  counts.badEstimate++;
  return null;
}

// Distinct non-empty values in first-seen order.
export function distinct(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}
