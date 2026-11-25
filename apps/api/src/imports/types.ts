// Normalised source data an import turns into issues (engine.ts). The source
// clients (GitHub, GitLab, Gitea / Forgejo) produce it.

// A person in the source. `key` is stable within one import (the source's user id or
// login) and keys the people mapping.
export interface SourcePerson {
  key: string;
  login: string;
  name: string | null;
  email: string | null;
}

export interface SourceComment {
  author: SourcePerson;
  body: string;
  createdAt: string;
}

export interface SourceIssue {
  url: string;
  number: number;
  title: string;
  body: string;
  // `notPlanned` is GitHub's "closed as not planned".
  state: 'open' | 'closed' | 'notPlanned';
  labels: { name: string; color: string | null }[];
  author: SourcePerson;
  assignee: SourcePerson | null;
  createdAt: string;
  closedAt: string | null;
  comments: SourceComment[];
  // CSV sources (csv/): the row's identity within the destination team (`jira:<key>`,
  // `csv:<id>` or `csv:<file sha256>:<row>`), used instead of `url`, which is empty;
  // the source status text the Statuses step maps to a state; priority 0–4; the
  // estimate as written (checked against the team's scale on import); the due date as
  // YYYY-MM-DD.
  sourceKey?: string;
  status?: string | null;
  priority?: number;
  estimate?: number | null;
  dueDate?: string | null;
}

export type ServiceLabel = 'GitHub' | 'GitLab' | 'Gitea' | 'Forgejo' | 'Jira' | 'CSV';

export interface SourceData {
  serviceLabel: ServiceLabel;
  issues: SourceIssue[];
  // A CSV file's rows that were not read (no title) and the values left empty or
  // replaced; the import's summary reports them.
  csv?: { skipped: { row: number; reason: string }[]; counts: CsvCounts };
}

export interface CsvCounts {
  badDates: number;
  missingCreated: number;
  badPriority: number;
  badEstimate: number;
}

// The processing step's counts. `total` is the number of source issues, so the page
// reads "Imported <issues + skippedExisting> of <total> issues".
export interface ImportSummary {
  issues: number;
  skippedExisting: number;
  comments: number;
  labelsCreated: number;
  total: number;
  skipped: { url: string; reason: string }[];
  // CSV imports: values that did not read (csv/source.ts) and estimates off the team's
  // scale, each left empty (a created date takes the import time).
  counts?: CsvCounts;
}

// Linear's IssueImport.status values used here.
export type ImportStatus = 'inProgress' | 'inProcess' | 'complete' | 'error';
