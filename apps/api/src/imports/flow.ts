import { db, teamMember, user } from '@repo/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { memberEmails } from '../accounts/emails';
import { HttpError, pgErrorCode, UUID_RE } from '../shared/lib';
import { shownName } from '../shared/user-name';
import { processImport, suggestPeople } from './engine';
import { withRateLimitNotice } from './sources/http';
import {
  claimForProcessing,
  getImport,
  setImportStatus,
  setWaitingUntil,
  type ImportRow,
} from './store';
import type { SourceData, SourcePerson } from './types';

// The steps every import goes through, whatever its source: a background fetch, the
// people matching while the fetched data waits in memory, then processing. Used by
// the instance endpoints (GitLab, Gitea, Forgejo; handlers.ts) and by Linear's GitHub
// mutations (github.ts, graphql/resolvers/issue-import.ts). An API restart in between
// ends a waiting import as an error (store.ts sweepInterruptedImports).

// Fetched source data waits this long for the people matching, then the import ends.
const WAIT_FOR_PEOPLE_MS = 24 * 60 * 60 * 1000;
export const EXPIRED = 'Expired, run the import again';

// Fetched source data of imports waiting for people matching, by import id, with the
// time the fetch ended.
const fetched = new Map<string, { data: SourceData; at: number }>();

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
      // While a request waits for the source's rate limit, the import shows until when.
      const data = await withRateLimitNotice(
        (until) => setWaitingUntil(row.id, until),
        fetchSource,
      );
      await setWaitingUntil(row.id, null);
      fetched.set(row.id, { data, at: Date.now() });
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
      await setWaitingUntil(row.id, null);
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
  const data = fetched.get(row.id)?.data;
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

// Starts processing a fetched import with the people mapping. The fetched data is
// taken before anything else, so a second request for the same import finds none; the
// import is then claimed in one statement, and the database allows one running import
// per team. A person matched to someone who may not be chosen (not, or no longer, a
// member of the team) is left unmatched.
export async function startProcessing(
  row: ImportRow,
  people: Record<string, string | null>,
): Promise<ImportRow> {
  const entry = fetched.get(row.id);
  if (!entry) throw new HttpError(409, 'The import is not waiting for people matching');
  fetched.delete(row.id);
  let claimed: ImportRow | null;
  let allowed: Record<string, string | null>;
  try {
    const known = new Set((await candidates(row)).map((m) => m.id));
    allowed = Object.fromEntries(
      Object.entries(people).map(([key, id]) => [key, id !== null && known.has(id) ? id : null]),
    );
    claimed = await claimForProcessing(row.id);
  } catch (err) {
    fetched.set(row.id, entry);
    if (pgErrorCode(err) === '23505')
      throw new HttpError(409, 'Another import into this team is running');
    throw err;
  }
  if (!claimed) throw new HttpError(409, 'The import is not waiting for people matching');
  void processImport(row.id, entry.data, allowed).catch(() => {
    // processImport records the error on the import.
  });
  return claimed;
}

// Ends the imports whose fetched data has waited longer than WAIT_FOR_PEOPLE_MS for
// the people matching (the API checks hourly, index.ts), freeing their memory.
export async function expireWaitingImports(now: Date = new Date()): Promise<void> {
  for (const [id, entry] of [...fetched]) {
    if (now.getTime() - entry.at < WAIT_FOR_PEOPLE_MS) continue;
    fetched.delete(id);
    const row = await getImport(id);
    if (row?.status === 'inProgress') await setImportStatus(id, 'error', { error: EXPIRED });
  }
}
