import type { SourceComment, SourceIssue } from '../types';
import { dayOf, parseJiraDate } from './dates';
import { parsePriority } from './guess';
import type { ParsedCsv } from './parse';
import {
  distinct,
  emptyCounts,
  personFor,
  readEstimate,
  rowNumber,
  uniqueLabels,
  UNKNOWN_PERSON,
  type CsvSource,
} from './source';
import { wikiToMarkdown } from './wiki';

// Jira's CSV export (Issues → Export → CSV, all fields): columns are found by header
// name, ignoring case; Labels and Comment repeat, one value per column. A comment cell is
// "date;author;text" (the text may hold more semicolons). Dates are Jira's export forms,
// read in UTC.

const STORY_POINTS = [
  'story points',
  'custom field (story points)',
  'custom field (story point estimate)',
];

export const isJiraCsv = (headers: string[]): boolean =>
  headers.some((h) => h.trim().toLowerCase() === 'summary');

function columns(headers: string[]) {
  const names = headers.map((h) => h.trim().toLowerCase());
  const one = (...wanted: string[]) => names.findIndex((n) => wanted.includes(n));
  const all = (name: string) => names.flatMap((n, i) => (n === name ? [i] : []));
  return {
    summary: one('summary'),
    key: one('issue key'),
    description: one('description'),
    status: one('status'),
    priority: one('priority'),
    assignee: one('assignee'),
    reporter: one('reporter', 'creator'),
    created: one('created'),
    resolved: one('resolved'),
    due: one('due date'),
    points: one(...STORY_POINTS),
    labels: all('labels'),
    comments: all('comment'),
  };
}

function comment(cell: string, counts: CsvSource['counts']): SourceComment | null {
  const value = cell.trim();
  if (!value) return null;
  const first = value.indexOf(';');
  const second = first === -1 ? -1 : value.indexOf(';', first + 1);
  if (second === -1) return { author: UNKNOWN_PERSON, body: wikiToMarkdown(value), createdAt: '' };
  const date = value.slice(0, first);
  const createdAt = parseJiraDate(date);
  if (!createdAt && date.trim()) counts.badDates++;
  return {
    author: personFor(value.slice(first + 1, second)) ?? UNKNOWN_PERSON,
    body: wikiToMarkdown(value.slice(second + 1).trim()),
    createdAt: createdAt ?? '',
  };
}

export function readJiraCsv(parsed: ParsedCsv, sha256: string): CsvSource {
  const col = columns(parsed.headers);
  const counts = emptyCounts();
  const skipped: CsvSource['skipped'] = [];
  const issues: SourceIssue[] = [];
  const cell = (row: string[], i: number) => (i === -1 ? '' : (row[i] ?? '').trim());
  const date = (row: string[], i: number) => {
    const value = cell(row, i);
    const iso = parseJiraDate(value);
    if (!iso && value) counts.badDates++;
    return iso;
  };

  parsed.rows.forEach((row, index) => {
    const title = cell(row, col.summary);
    if (!title) {
      skipped.push({ row: rowNumber(index), reason: 'No title' });
      return;
    }
    const key = cell(row, col.key);
    const createdAt = date(row, col.created);
    if (!createdAt) counts.missingCreated++;
    const priority = parsePriority(cell(row, col.priority));
    if (priority === null) counts.badPriority++;
    issues.push({
      url: '',
      sourceKey: key ? `jira:${key}` : `csv:${sha256}:${rowNumber(index)}`,
      number: Number(/-(\d+)$/.exec(key)?.[1] ?? rowNumber(index)),
      title,
      body: wikiToMarkdown(cell(row, col.description)),
      state: 'open',
      status: cell(row, col.status) || null,
      priority: priority ?? 0,
      estimate: readEstimate(cell(row, col.points), counts),
      labels: uniqueLabels(col.labels.map((i) => cell(row, i))),
      author: personFor(cell(row, col.reporter)) ?? UNKNOWN_PERSON,
      assignee: personFor(cell(row, col.assignee)),
      createdAt: createdAt ?? '',
      closedAt: date(row, col.resolved),
      dueDate: dayOf(date(row, col.due)),
      comments: col.comments.flatMap((i) => comment(cell(row, i), counts) ?? []),
    });
  });

  return {
    data: { serviceLabel: 'Jira', issues },
    statuses: distinct(issues.map((i) => i.status)),
    skipped,
    counts,
  };
}
