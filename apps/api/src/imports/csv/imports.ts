import { HttpError } from '../../shared/lib';
import { canSeeTeam } from '../../shared/access';
import { readImportFile } from '../../uploads/import-files';
import { getUpload, setUploadUsed, uploadIdFromAssetUrl } from '../../uploads/store';
import { destinationStates } from '../engine';
import { beginFetch, isAwaitingPeople } from '../flow';
import { createImport, listImports, type ImportRow } from '../store';
import type { SourceData } from '../types';
import { readGenericCsv } from './generic';
import { guessColumns, guessStatusState, type ColumnMapping, type MappedField } from './guess';
import { isJiraCsv, readJiraCsv } from './jira';
import { parseCsv } from './parse';
import type { CsvSource } from './source';

// CSV imports (Linear's issueImportCheckCSV / issueImportCreateCSVJira, and the Import
// page's generic CSV through the instance endpoints): the uploaded import file is read
// and parsed when the import is created, so a file that does not read is refused at
// once; the rows then wait for the Statuses and People steps like a fetched source
// (flow.ts). The file stays stored (marked used) until the import ends (files.ts).

export const NOT_JIRA = 'The file is not a Jira CSV export (no Summary column)';

// Rows shown on the Columns step.
const SAMPLE_ROWS = 5;

// CSV imports one person may have waiting for their Statuses and People steps at once:
// each holds its parsed rows in memory until processed or expired.
const MAX_WAITING_CSV = 3;

const FIELDS: MappedField[] = [
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
];

async function readFile(userId: string, assetUrl: unknown) {
  if (typeof assetUrl !== 'string' || !assetUrl) throw new HttpError(400, 'csvUrl is required');
  const file = await readImportFile(userId, assetUrl);
  return { parsed: parseCsv(file.text), sha256: file.sha256 };
}

// Linear's issueImportCheckCSV: the file reads as a Jira export.
export async function checkJiraCsv(userId: string, csvUrl: unknown): Promise<void> {
  const { parsed } = await readFile(userId, csvUrl);
  if (!isJiraCsv(parsed.headers)) throw new HttpError(400, NOT_JIRA);
}

// The Columns step's data: the headers, the first rows, the guessed mapping, and
// whether the file reads as a Jira export.
export async function previewCsv(userId: string, assetUrl: unknown) {
  const { parsed } = await readFile(userId, assetUrl);
  return {
    headers: parsed.headers,
    sample: parsed.rows.slice(0, SAMPLE_ROWS),
    rows: parsed.rows.length,
    // Every row, so evidence for the date format anywhere in the file counts.
    guess: guessColumns(parsed.headers, parsed.rows),
    jira: isJiraCsv(parsed.headers),
  };
}

// A column mapping from a request: column numbers for the known fields (null or
// missing leaves a field unmapped), `title` required, and the date format.
export function columnMapping(value: unknown): ColumnMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'mapping must map fields to columns');
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (key !== 'dateFormat' && !(FIELDS as string[]).includes(key))
      throw new HttpError(400, `mapping: unknown field ${key}`);
  if (typeof input.title !== 'number') throw new HttpError(400, 'mapping: title is required');
  const out: Record<string, unknown> = { dateFormat: input.dateFormat };
  for (const field of FIELDS)
    if (input[field] !== undefined && input[field] !== null) out[field] = input[field];
  // readGenericCsv checks the column numbers and the date format.
  return out as unknown as ColumnMapping;
}

// A Jira site's host from what the person typed ("acme.atlassian.net",
// "https://jira.acme.com/"), or null when empty. Used only to link each issue back to
// its Jira page.
export function jiraHost(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'jiraHostname must be a host name');
  const host = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host))
    throw new HttpError(400, 'jiraHostname must be a host name');
  return host.toLowerCase();
}

export interface CsvImportInput {
  userId: string;
  assetUrl: unknown;
  source: 'jira' | 'generic';
  mapping?: unknown;
  teamId?: string | null;
  teamName?: string | null;
  jiraHostname?: unknown;
}

async function destination(
  userId: string,
  teamId: string | null | undefined,
  teamName: string | null | undefined,
) {
  if (teamId) {
    if (!(await canSeeTeam(teamId, userId))) throw new HttpError(404, 'Team not found');
    return { teamId, teamName: null };
  }
  const name = teamName?.trim();
  if (!name) throw new HttpError(400, 'Provide either teamId or teamName');
  return { teamId: null, teamName: name };
}

// Creates a CSV import: reads the file, then holds its rows for the Statuses and
// People steps. The file is marked used so the daily upload sweep keeps it.
export async function createCsvImport(input: CsvImportInput): Promise<ImportRow> {
  const team = await destination(input.userId, input.teamId, input.teamName);
  const waiting = (await listImports()).filter(
    (r) =>
      r.creatorId === input.userId &&
      (r.service === 'jira' || r.service === 'csv') &&
      isAwaitingPeople(r),
  );
  if (waiting.length >= MAX_WAITING_CSV)
    throw new HttpError(409, 'Finish or cancel a waiting import first');
  const host = input.source === 'jira' ? jiraHost(input.jiraHostname) : null;
  const { parsed, sha256 } = await readFile(input.userId, input.assetUrl);
  let source: CsvSource;
  if (input.source === 'jira') {
    if (!isJiraCsv(parsed.headers)) throw new HttpError(400, NOT_JIRA);
    source = readJiraCsv(parsed, sha256);
    if (host)
      for (const issue of source.data.issues)
        if (issue.sourceKey?.startsWith('jira:'))
          issue.url = `https://${host}/browse/${encodeURIComponent(issue.sourceKey.slice('jira:'.length))}`;
  } else {
    source = readGenericCsv(parsed, columnMapping(input.mapping), sha256);
  }
  const assetUrl = input.assetUrl as string;
  const uploadId = uploadIdFromAssetUrl(assetUrl)!;
  const upload = await getUpload(uploadId);
  const { states, defaultId } = await destinationStates(team.teamId);
  const statusGuesses = Object.fromEntries(
    source.statuses.map((value) => [value, guessStatusState(value, states, defaultId)]),
  );
  const data: SourceData = {
    ...source.data,
    csv: { skipped: source.skipped, counts: source.counts },
  };
  const row = await createImport({
    service: input.source === 'jira' ? 'jira' : 'csv',
    ...team,
    creatorId: input.userId,
    displayName: upload?.filename ?? 'CSV',
    serviceMetadata: {
      service: input.source === 'jira' ? 'Jira' : 'CSV',
      csvUrl: assetUrl,
      rows: parsed.rows.length,
      statuses: source.statuses,
      // value → state id (an existing team) or default state name (a new team).
      statusGuesses,
      ...(host ? { jiraHostname: host } : {}),
    },
  });
  // Marked used only once the import exists, so a refused create leaves the file to the
  // daily sweep of unused uploads.
  await setUploadUsed(uploadId, true);
  beginFetch(row, async () => data);
  return row;
}
