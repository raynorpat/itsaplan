import { HttpError } from '../../shared/lib';

// CSV for issue imports (RFC 4180): a header line, then rows. Quoted fields may hold
// the delimiter, doubled quotes and line breaks. The delimiter is a comma or a
// semicolon, whichever appears more often outside quotes in the header line (some
// locales' spreadsheet exports use semicolons). A byte order mark is dropped, blank
// lines are skipped and short rows are padded to the header width. Values are kept as
// plain text: nothing is evaluated, so a cell starting with "=" stays that text.

export const MAX_CSV_ROWS = 10_000;

export interface ParsedCsv {
  // Kept by position: Jira repeats headers such as Labels and Comment.
  headers: string[];
  rows: string[][];
}

function delimiterOf(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

function* records(text: string, delimiter: string): Generator<string[]> {
  let field = '';
  let record: string[] = [];
  let quoted = false;
  // The 1-based line where the open quote started, for the error on an unclosed one.
  let line = 1;
  let quoteLine = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      record.push(field);
      yield record;
      record = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
    } else {
      field += ch;
    }
    i++;
  }
  // A quote never closed would swallow the rest of the file into one value.
  if (quoted) throw new HttpError(400, `Unclosed quote starting on line ${quoteLine}`);
  if (field !== '' || record.length > 0) {
    record.push(field);
    yield record;
  }
}

const blank = (record: string[]) => record.every((v) => v.trim() === '');

// The header line and the data rows of a CSV file's text. 400 for an empty file or
// more than MAX_CSV_ROWS data rows.
export function parseCsv(input: string): ParsedCsv {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const delimiter = delimiterOf(text);
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for (const record of records(text, delimiter)) {
    if (blank(record)) continue;
    if (!headers) {
      headers = record.map((h) => h.trim());
      continue;
    }
    if (rows.length === MAX_CSV_ROWS) throw new HttpError(400, 'At most 10,000 rows per import');
    while (record.length < headers.length) record.push('');
    rows.push(record);
  }
  if (!headers) throw new HttpError(400, 'The file is empty');
  return { headers, rows };
}
