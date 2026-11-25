// Dates in CSV exports. Every value is read as UTC (exports carry no zone). Results are
// ISO strings, or null when the value is empty or not a real date.

export type DateFormat = 'iso' | 'dayFirst' | 'monthFirst';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ISO_RE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

function build(y: number, m: number, d: number, h = 0, min = 0, s = 0): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) return null;
  const date = new Date(Date.UTC(y, m - 1, d, h, min, s));
  // Date.UTC rolls 31 Feb into March: a real date keeps its parts.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString();
}

function readIso(value: string): string | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  const local = build(+y!, +mo!, +d!, h ? +h : 0, mi ? +mi : 0, s ? +s : 0);
  if (!local || !zone || zone.toUpperCase() === 'Z') return local;
  const offset = /([+-])(\d{2}):?(\d{2})/.exec(zone)!;
  const minutes = (offset[1] === '-' ? -1 : 1) * (+offset[2]! * 60 + +offset[3]!);
  return new Date(Date.parse(local) - minutes * 60_000).toISOString();
}

function readTime(value: string | undefined): [number, number, number] | null {
  if (!value) return [0, 0, 0];
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  let h = +m[1]!;
  const ampm = m[4]?.toUpperCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'PM' ? 12 : 0);
  }
  return [h, +m[2]!, m[3] ? +m[3] : 0];
}

const fullYear = (y: string): number => (y.length <= 2 ? 2000 + +y : +y);

// "25/Nov/26 10:15 AM", "25/Nov/2026", or ISO.
export function parseJiraDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = readIso(value);
  if (iso) return iso;
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})(?:\s+(.+))?$/.exec(value);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const time = readTime(m[4]);
  if (!month || !time) return null;
  return build(fullYear(m[3]!), month, +m[1]!, ...time);
}

// A date in the chosen format (separators / . or -, a two- or four-digit year, an
// optional time with AM/PM). ISO values (year first) read in any format; with `iso`
// only they read.
export function parseDate(raw: string, format: DateFormat): string | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = readIso(value);
  if (iso || format === 'iso') return iso;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T]+(.+))?$/.exec(value);
  if (!m) return null;
  const [day, month] = format === 'dayFirst' ? [+m[1]!, +m[2]!] : [+m[2]!, +m[1]!];
  const time = readTime(m[4]);
  if (!time) return null;
  return build(fullYear(m[3]!), month, day, ...time);
}

// The format of a column's values: ISO when every value is; day first when any first
// part is above 12; else month first.
export function guessDateFormat(values: string[]): DateFormat {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.every((v) => readIso(v))) return 'iso';
  for (const v of filled) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(v);
    if (m && +m[1]! > 12) return 'dayFirst';
  }
  return 'monthFirst';
}

// The day part of an ISO date, for due dates.
export const dayOf = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);
