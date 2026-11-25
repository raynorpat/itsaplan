import { getActiveSession, type ImportsHandlers } from '@repo/auth';
import { atLeast, canSeeTeam, workspaceRole } from '../shared/access';
import { HttpError, UUID_RE } from '../shared/lib';
import { createCsvImport, previewCsv } from './csv/imports';
import {
  beginFetch,
  findImport,
  importPeople,
  importView,
  peopleMapping,
  startProcessing,
  statusMapping,
} from './flow';
import { disconnectGithub, githubRepositories, githubStatus } from './github';
import { fetchGitea, listGiteaRepos, type SourceRepository } from './sources/gitea';
import { fetchGitlab, listGitlabProjects } from './sources/gitlab';
import { createImport, listImports } from './store';
import type { SourceData } from './types';

// The instance plugin's import endpoints (packages/auth src/instance-plugin.ts):
// imports from GitLab, Gitea and Forgejo and from a generic CSV file, which Linear's
// schema has no import for (a Jira CSV too, the same as issueImportCreateCSVJira), and
// what the Import page reads that Linear's schema has no query for (the imports, the
// people step, the GitHub connection and its repositories). Workspace owners and
// admins only. A pasted token is used by the fetch running in this process and
// dropped when the fetch ends (flow.ts).

const SERVICES = ['gitlab', 'gitea', 'forgejo'] as const;
type TokenService = (typeof SERVICES)[number];

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

export const importsHandlers: ImportsHandlers = {
  list: async (headers) => {
    await adminId(headers);
    return { imports: (await listImports()).map(importView) };
  },

  get: async (headers, query) => {
    await adminId(headers);
    return { import: importView(await findImport(query.id)) };
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
    beginFetch(row, () => fetchSource(svc, host, token, repository, includeClosed, labels), {
      secret: token,
    });
    return { import: importView(row) };
  },

  people: async (headers, query) => {
    await adminId(headers);
    return importPeople(await findImport(query.id));
  },

  // The Columns step's data for an uploaded import file.
  csvPreview: async (headers, body) => {
    const userId = await adminId(headers);
    return previewCsv(userId, fields(body).assetUrl);
  },

  // A CSV import: `source` jira (Jira's export) or generic (with `mapping`, the
  // confirmed columns), into `teamId` or a new team named `teamName`.
  csvCreate: async (headers, body) => {
    const userId = await adminId(headers);
    const b = fields(body);
    if (b.source !== 'jira' && b.source !== 'generic')
      throw new HttpError(400, 'source must be jira or generic');
    const teamId = typeof b.teamId === 'string' && b.teamId ? b.teamId : null;
    if (teamId && !UUID_RE.test(teamId)) throw new HttpError(404, 'Team not found');
    const row = await createCsvImport({
      userId,
      assetUrl: b.assetUrl,
      source: b.source,
      mapping: b.mapping,
      teamId,
      teamName: typeof b.teamName === 'string' ? b.teamName : null,
      jiraHostname: b.jiraHostname,
    });
    return { import: importView(row) };
  },

  process: async (headers, body) => {
    await adminId(headers);
    const b = fields(body);
    const row = await findImport(b.id);
    return {
      import: importView(
        await startProcessing(row, peopleMapping(b.people), statusMapping(b.statuses)),
      ),
    };
  },

  github: async (headers) => {
    await adminId(headers);
    return githubStatus();
  },

  githubRepositories: async (headers) => {
    await adminId(headers);
    return { repositories: await githubRepositories() };
  },

  githubDisconnect: async (headers) => {
    await adminId(headers);
    await disconnectGithub();
    return { success: true };
  },
};
