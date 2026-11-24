// An issue import as /api/auth/instance/imports* returns it (Linear's IssueImport plus
// `awaitingPeople`, true once the source is fetched and the people matching is due).

export type ImportService = 'github' | 'gitlab' | 'gitea' | 'forgejo';
export type ImportStatus = 'inProgress' | 'inProcess' | 'complete' | 'error';

export interface ImportSummary {
  issues: number;
  skippedExisting: number;
  comments: number;
  labelsCreated: number;
  total: number;
  skipped: { url: string; reason: string }[];
}

export interface ImportView {
  id: string;
  service: string;
  status: ImportStatus;
  progress: number | null;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
  creatorId: string | null;
  serviceMetadata: Record<string, unknown>;
  summary: ImportSummary | null;
  error: string | null;
  awaitingPeople: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SERVICE_LABEL: Record<ImportService, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
};

export function importStatusText(imp: ImportView): string {
  switch (imp.status) {
    case 'inProgress':
      return imp.awaitingPeople ? 'Match people to continue' : 'Fetching issues…';
    case 'inProcess': {
      const s = imp.summary;
      if (!s) return 'Starting…';
      const done = s.issues + s.skippedExisting + s.skipped.length;
      return `Imported ${done} of ${s.total} issues`;
    }
    case 'complete':
      return 'Complete';
    case 'error':
      return imp.error ?? 'Failed';
  }
}

// Whether the import is still working on its own (fetching or creating records), so
// the page keeps polling. An import waiting for people matching waits for the admin.
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A finished import's summary line ("3 issues · 2 comments · 1 label created"), null
// before it completes.
export function importSummaryText(imp: ImportView): string | null {
  const s = imp.summary;
  if (imp.status !== 'complete' || !s) return null;
  const parts = [count(s.issues, 'issue', 'issues'), count(s.comments, 'comment', 'comments')];
  if (s.labelsCreated) parts.push(`${count(s.labelsCreated, 'label', 'labels')} created`);
  if (s.skippedExisting) parts.push(`${s.skippedExisting} already imported`);
  if (s.skipped.length) parts.push(`${s.skipped.length} skipped`);
  return parts.join(' · ');
}

export function importIsRunning(imp: ImportView): boolean {
  if (imp.status === 'inProcess') return true;
  return imp.status === 'inProgress' && !imp.awaitingPeople;
}

// The people mapping the process step sends: source person key → member id, or null to
// leave that person's issues unassigned (and the importer as creator).
export function peopleMappingInput(
  rows: { key: string; memberId: string | null }[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const row of rows) out[row.key] = row.memberId ? row.memberId : null;
  return out;
}

// The team picker's value for "a new team" (any other value is a team id).
export const NEW_TEAM = '__new__';

export interface DestinationForm {
  team: string;
  newTeamName: string;
  includeClosed: boolean;
  // Comma-separated source label names; empty imports every issue.
  labels: string;
}

// Where an import goes and what it reads from the source.
export interface ImportDestination {
  teamId: string | null;
  teamName: string | null;
  includeClosed: boolean;
  labels: string[];
}

export function destinationInput(form: DestinationForm): ImportDestination | { error: string } {
  const labels = form.labels
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!form.team) return { error: 'Choose a team to import into' };
  if (form.team === NEW_TEAM) {
    const name = form.newTeamName.trim();
    if (!name) return { error: 'Name the new team' };
    return { teamId: null, teamName: name, includeClosed: form.includeClosed, labels };
  }
  return { teamId: form.team, teamName: null, includeClosed: form.includeClosed, labels };
}
