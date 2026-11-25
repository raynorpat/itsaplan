import { HttpError } from '../../shared/lib';
import type { SourceIssue } from '../types';
import { dayOf, parseDate } from './dates';
import { parsePriority, type ColumnMapping, type MappedField } from './guess';
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

// A CSV from any tool, read through the column mapping the person confirmed on the
// Import page. Labels are one column split on commas or semicolons; dates are read in
// the chosen format, in UTC; unmapped columns are ignored.

const FORMATS = ['iso', 'dayFirst', 'monthFirst'];

function checkMapping(mapping: ColumnMapping, width: number): void {
  if (!FORMATS.includes(mapping.dateFormat))
    throw new HttpError(400, 'dateFormat must be iso, dayFirst or monthFirst');
  const used = new Set<number>();
  for (const [field, index] of Object.entries(mapping) as [MappedField | 'dateFormat', unknown][]) {
    if (field === 'dateFormat' || index === undefined) continue;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= width)
      throw new HttpError(400, `${field}: ${String(index)} is not a column of the file`);
    if (used.has(index)) throw new HttpError(400, 'Each column can be used once');
    used.add(index);
  }
}

export function readGenericCsv(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  sha256: string,
): CsvSource {
  checkMapping(mapping, parsed.headers.length);
  const counts = emptyCounts();
  const skipped: CsvSource['skipped'] = [];
  const issues: SourceIssue[] = [];
  const cell = (row: string[], field: MappedField) => {
    const i = mapping[field];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const date = (row: string[], field: MappedField) => {
    const value = cell(row, field);
    const iso = parseDate(value, mapping.dateFormat);
    if (!iso && value) counts.badDates++;
    return iso;
  };

  parsed.rows.forEach((row, index) => {
    const title = cell(row, 'title');
    if (!title) {
      skipped.push({ row: rowNumber(index), reason: 'No title' });
      return;
    }
    const id = cell(row, 'id');
    const createdAt = date(row, 'createdAt');
    if (!createdAt) counts.missingCreated++;
    const priority = parsePriority(cell(row, 'priority'));
    if (priority === null) counts.badPriority++;
    issues.push({
      url: '',
      sourceKey: id ? `csv:${id}` : `csv:${sha256}:${rowNumber(index)}`,
      number: /^\d+$/.test(id) ? Number(id) : rowNumber(index),
      title,
      body: cell(row, 'description'),
      state: 'open',
      status: cell(row, 'status') || null,
      priority: priority ?? 0,
      estimate: readEstimate(cell(row, 'estimate'), counts),
      labels: uniqueLabels(cell(row, 'labels').split(/[,;]/)),
      author: personFor(cell(row, 'creator')) ?? UNKNOWN_PERSON,
      assignee: personFor(cell(row, 'assignee')),
      createdAt: createdAt ?? '',
      closedAt: date(row, 'completedAt'),
      dueDate: dayOf(date(row, 'dueDate')),
      comments: [],
    });
  });

  return {
    data: { serviceLabel: 'CSV', issues },
    statuses: distinct(issues.map((i) => i.status)),
    skipped,
    counts,
  };
}
