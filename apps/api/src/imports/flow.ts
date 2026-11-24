import { db, issueImport, teamMember, user } from '@repo/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { memberEmails } from '../accounts/emails';
import { HttpError, UUID_RE } from '../shared/lib';
import { shownName } from '../shared/user-name';
import { processImport, suggestPeople } from './engine';
import { getImport, setImportStatus, type ImportRow } from './store';
import type { SourceData, SourcePerson } from './types';

// The steps every import goes through, whatever its source: a background fetch, the
// people matching while the fetched data waits in memory, then processing. Used by
// the instance endpoints (GitLab, Gitea, Forgejo; handlers.ts) and by Linear's GitHub
// mutations (github.ts, graphql/resolvers/issue-import.ts). An API restart in between
// ends a waiting import as an error (store.ts sweepInterruptedImports).

// Fetched source data of imports waiting for people matching, by import id.
const fetched = new Map<string, SourceData>();

export function isAwaitingPeople(row: ImportRow): boolean {
  return row.status === 'inProgress' && fetched.has(row.id);
}

// An import as the Import page reads it. `awaitingPeople`: fetched and waiting for the
// people matching (Linear's inProgress "configuration" stage).
export function importView(row: ImportRow) {
  return {
    id: row.id,
    service: row.service,
    status: row.status,
    progress: row.progress,
    displayName: row.displayName,
    teamId: row.teamId,
    teamName: row.teamName,
    creatorId: row.creatorId,
    serviceMetadata: row.serviceMetadata,
    summary: row.summary,
    error: row.error,
    awaitingPeople: isAwaitingPeople(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findImport(id: unknown): Promise<ImportRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id))
    throw new HttpError(400, 'id must be an import id');
  const row = await getImport(id);
  if (!row) throw new HttpError(404, 'Import not found');
  return row;
}

// Fetches in the background. `secret` (a pasted token) is redacted from an error
// message; it lives only in the fetch's closure. With `instantProcess` the suggested
// people matching is applied and processing starts at once (Linear's instantProcess).
export function beginFetch(
  row: ImportRow,
  fetchSource: () => Promise<SourceData>,
  opts: { secret?: string; instantProcess?: boolean } = {},
): void {
  void (async () => {
    try {
      const data = await fetchSource();
      fetched.set(row.id, data);
      await setImportStatus(row.id, 'inProgress', { progress: 100 });
      if (opts.instantProcess) {
        const { people, members } = await peopleOf(row);
        const suggested = suggestPeople(
          people.map((p) => p.person),
          members,
        );
        await startProcessing(row, suggested);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The fetch failed';
      const secret = opts.secret;
      await setImportStatus(row.id, 'error', {
        error: secret ? message.split(secret).join('***') : message,
      });
    }
  })();
}

// The members a source person may be matched to: the destination team's members, or
// for a team the import creates, every active workspace member (the matched ones join
// the new team when it is created).
async function candidates(row: ImportRow) {
  const rows = row.teamId
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(teamMember)
        .innerJoin(user, eq(user.id, teamMember.userId))
        .where(and(eq(teamMember.teamId, row.teamId), isNull(user.suspendedAt)))
    : await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(and(isNull(user.suspendedAt), ne(user.workspaceRole, 'app')));
  const emails = await memberEmails(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    name: shownName(r),
    emails: emails.get(r.id) ?? [r.email.toLowerCase()],
  }));
}

// The people of the fetched data with their issue counts, in order of appearance,
// and the members they may be matched to.
async function peopleOf(row: ImportRow) {
  const data = fetched.get(row.id);
  if (!data) throw new HttpError(409, 'The import is not waiting for people matching');
  const byKey = new Map<string, { person: SourcePerson; issues: Set<string> }>();
  const note = (p: SourcePerson | null, issueUrl: string) => {
    if (!p) return;
    const entry = byKey.get(p.key) ?? { person: p, issues: new Set<string>() };
    entry.issues.add(issueUrl);
    byKey.set(p.key, entry);
  };
  for (const i of data.issues) {
    note(i.author, i.url);
    note(i.assignee, i.url);
    for (const c of i.comments) note(c.author, i.url);
  }
  return {
    people: [...byKey.values()].map((e) => ({ person: e.person, issues: e.issues.size })),
    members: await candidates(row),
  };
}

// The people step's data: each source person with their issue count and suggested
// member, and the members to choose from.
export async function importPeople(row: ImportRow) {
  const { people, members } = await peopleOf(row);
  const suggested = suggestPeople(
    people.map((p) => p.person),
    members,
  );
  return {
    people: people.map(({ person, issues }) => ({
      key: person.key,
      login: person.login,
      name: person.name,
      email: person.email,
      issues,
      suggestion: suggested[person.key] ?? null,
    })),
    members: members.map((m) => ({ id: m.id, name: m.name })),
  };
}

// The people mapping from a request (source person key → member id or null).
export function peopleMapping(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'people must map source people to members');
  const out: Record<string, string | null> = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (id === null || id === '') out[key] = null;
    else if (typeof id === 'string' && UUID_RE.test(id)) out[key] = id;
    else throw new HttpError(400, 'people must map source people to member ids or null');
  }
  return out;
}

// Starts processing a fetched import with the people mapping. One running import per
// team.
export async function startProcessing(
  row: ImportRow,
  people: Record<string, string | null>,
): Promise<ImportRow> {
  const data = fetched.get(row.id);
  if (row.status !== 'inProgress' || !data)
    throw new HttpError(409, 'The import is not waiting for people matching');
  if (row.teamId) {
    const [running] = await db
      .select({ id: issueImport.id })
      .from(issueImport)
      .where(and(eq(issueImport.teamId, row.teamId), eq(issueImport.status, 'inProcess')));
    if (running) throw new HttpError(409, 'Another import into this team is running');
  }
  const known = new Set((await candidates(row)).map((m) => m.id));
  for (const id of Object.values(people))
    if (id !== null && !known.has(id))
      throw new HttpError(400, 'A matched person is not a member of the team');
  fetched.delete(row.id);
  void processImport(row.id, data, people).catch(() => {
    // processImport records the error on the import.
  });
  return { ...row, status: 'inProcess' };
}
