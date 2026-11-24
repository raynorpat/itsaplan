import { db, issueImport, teamMember, user } from '@repo/db';
import { getActiveSession, type ImportsHandlers } from '@repo/auth';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { memberEmails } from '../accounts/emails';
import { atLeast, canSeeTeam, workspaceRole } from '../shared/access';
import { HttpError, UUID_RE } from '../shared/lib';
import { shownName } from '../shared/user-name';
import { processImport, suggestPeople } from './engine';
import { fetchGitea, listGiteaRepos, type SourceRepository } from './sources/gitea';
import { fetchGitlab, listGitlabProjects } from './sources/gitlab';
import { createImport, getImport, listImports, setImportStatus, type ImportRow } from './store';
import type { SourceData, SourcePerson } from './types';

// The instance plugin's import endpoints (packages/auth src/instance-plugin.ts) for the
// sources Linear's schema has no import for: GitLab, Gitea and Forgejo. Workspace
// owners and admins only. The token is passed once, used by the fetch running in this
// process and dropped when the fetch ends; the fetched data is kept in memory until
// the people are matched and the import is processed (an API restart ends a waiting
// import as an error, store.ts sweepInterruptedImports).

const SERVICES = ['gitlab', 'gitea', 'forgejo'] as const;
type TokenService = (typeof SERVICES)[number];

// Fetched source data of imports waiting for people matching, by import id.
const fetched = new Map<string, SourceData>();

async function adminId(headers: Headers): Promise<string> {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  if (!atLeast(await workspaceRole(session.user.id), 'admin'))
    throw new HttpError(403, 'Only a workspace admin or owner can import issues');
  return session.user.id;
}

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${what} is required`);
  return value.trim();
}

function service(value: unknown): TokenService {
  if (typeof value === 'string' && (SERVICES as readonly string[]).includes(value))
    return value as TokenService;
  throw new HttpError(400, 'service must be gitlab, gitea or forgejo');
}

function labelFilter(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new HttpError(400, 'labels must be a list of label names');
  return (value as string[]).map((v) => v.trim()).filter(Boolean);
}

async function importId(value: unknown): Promise<ImportRow> {
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, 'id must be an import id');
  const row = await getImport(value);
  if (!row) throw new HttpError(404, 'Import not found');
  return row;
}

// An import as the page reads it. `awaitingPeople`: fetched and waiting for the
// people matching (Linear's inProgress "configuration" stage).
function view(row: ImportRow) {
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
    awaitingPeople: row.status === 'inProgress' && fetched.has(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function listRepositories(svc: TokenService, host: string, token: string) {
  return svc === 'gitlab' ? listGitlabProjects(host, token) : listGiteaRepos(host, token);
}

function fetchSource(
  svc: TokenService,
  host: string,
  token: string,
  repository: string,
  includeClosed: boolean,
  labels: string[],
): Promise<SourceData> {
  if (svc === 'gitlab') return fetchGitlab(host, token, repository, { includeClosed, labels });
  return fetchGitea(host, token, repository, {
    includeClosed,
    labels,
    serviceLabel: svc === 'gitea' ? 'Gitea' : 'Forgejo',
  });
}

const SERVICE_NAME: Record<TokenService, string> = {
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
};

// Fetches in the background; the token lives only in this closure.
function startFetch(
  row: ImportRow,
  svc: TokenService,
  host: string,
  token: string,
  repository: string,
  includeClosed: boolean,
  labels: string[],
): void {
  void (async () => {
    try {
      const data = await fetchSource(svc, host, token, repository, includeClosed, labels);
      fetched.set(row.id, data);
      await setImportStatus(row.id, 'inProgress', { progress: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The fetch failed';
      await setImportStatus(row.id, 'error', {
        error: token ? message.split(token).join('***') : message,
      });
    }
  })();
}

// The people of the fetched data with their issue counts, in order of appearance.
function peopleOf(data: SourceData): { person: SourcePerson; issues: number }[] {
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
  return [...byKey.values()].map((e) => ({ person: e.person, issues: e.issues.size }));
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

export const importsHandlers: ImportsHandlers = {
  list: async (headers) => {
    await adminId(headers);
    return { imports: (await listImports()).map(view) };
  },

  get: async (headers, query) => {
    await adminId(headers);
    return { import: view(await importId(query.id)) };
  },

  repositories: async (headers, body) => {
    await adminId(headers);
    const b = fields(body);
    const svc = service(b.service);
    const repositories: SourceRepository[] = await listRepositories(
      svc,
      text(b.host, 'host'),
      text(b.token, 'token'),
    );
    return { repositories };
  },

  start: async (headers, body) => {
    const userId = await adminId(headers);
    const b = fields(body);
    const svc = service(b.service);
    const host = text(b.host, 'host');
    const token = text(b.token, 'token');
    const repository = text(b.repository, 'repository');
    const labels = labelFilter(b.labels);
    const includeClosed = b.includeClosed === true;
    let teamId: string | null = null;
    let teamName: string | null = null;
    if (typeof b.teamId === 'string' && b.teamId) {
      if (!UUID_RE.test(b.teamId) || !(await canSeeTeam(b.teamId, userId)))
        throw new HttpError(404, 'Team not found');
      teamId = b.teamId;
    } else {
      teamName = text(b.teamName, 'teamId or teamName');
    }
    const row = await createImport({
      service: svc,
      teamId,
      teamName,
      creatorId: userId,
      displayName: repository,
      serviceMetadata: { host, repository, includeClosed, labels, service: SERVICE_NAME[svc] },
    });
    startFetch(row, svc, host, token, repository, includeClosed, labels);
    return { import: view(row) };
  },

  people: async (headers, query) => {
    await adminId(headers);
    const row = await importId(query.id);
    const data = fetched.get(row.id);
    if (!data) throw new HttpError(409, 'The import is not waiting for people matching');
    const people = peopleOf(data);
    const members = await candidates(row);
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
  },

  process: async (headers, body) => {
    await adminId(headers);
    const b = fields(body);
    const row = await importId(b.id);
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
    const people = peopleMapping(b.people);
    const known = new Set((await candidates(row)).map((m) => m.id));
    for (const id of Object.values(people))
      if (id !== null && !known.has(id))
        throw new HttpError(400, 'A matched person is not a member of the team');
    fetched.delete(row.id);
    void processImport(row.id, data, people).catch(() => {
      // processImport records the error on the import.
    });
    return { import: view({ ...row, status: 'inProcess' }) };
  },
};

function peopleMapping(value: unknown): Record<string, string | null> {
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
