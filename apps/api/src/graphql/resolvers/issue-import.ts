import { checkJiraCsv, createCsvImport } from '../../imports/csv/imports';
import {
  findImport,
  isAwaitingPeople,
  peopleMapping,
  startProcessing,
  statusMapping,
} from '../../imports/flow';
import {
  connectGithub,
  createGithubImport,
  getIntegration,
  githubRepositories,
  type IntegrationRow,
} from '../../imports/github';
import { setImportMapping, type ImportRow } from '../../imports/store';
import { atLeast, canSeeTeam, workspaceRole } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { userById } from './issue';
import { guard, lastSyncId } from './mutations';
import { getOrganization } from './organization';

// Linear's IssueImport from an import job (apps/api/src/imports). It is reached
// through IssueImportPayload and IssueHistory.issueImport; the job never holds a token.
// Without `full` (anyone below admin reading an imported issue's history) the error,
// the people mapping and the source's server address are left out.
export function toIssueImport(row: ImportRow, full = true) {
  const metadata = row.serviceMetadata ?? null;
  return {
    id: row.id,
    service: row.service,
    status: row.status,
    progress: row.progress,
    displayName: row.displayName,
    teamName: row.teamName,
    creatorId: row.creatorId,
    serviceMetadata: full || !metadata ? metadata : omitHost(metadata),
    mapping: full ? (row.mapping ?? null) : null,
    error: full ? row.error : null,
    errorMetadata: null,
    csvFileUrl: full && typeof metadata?.csvUrl === 'string' ? metadata.csvUrl : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
  };
}

function omitHost(metadata: Record<string, unknown>): Record<string, unknown> {
  const { host: _host, csvUrl: _csvUrl, jiraHostname: _jiraHostname, ...rest } = metadata;
  return rest;
}

// Whether the viewer sees an import's details (the importers: owners and admins).
export async function seesImportDetails(ctx: GraphQLContext): Promise<boolean> {
  return atLeast(await workspaceRole(ctx.user.id), 'admin');
}

function toIntegration(row: IntegrationRow) {
  return {
    id: row.id,
    service: row.service,
    creatorId: row.creatorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
  };
}

// "Requires workspace import permission": owners and admins, as the instance's
// import endpoints.
async function assertImporter(ctx: GraphQLContext): Promise<void> {
  if (!atLeast(await workspaceRole(ctx.user.id), 'admin'))
    throw new HttpError(403, 'Only a workspace admin or owner can import issues');
}

const integrationPayload = (row: IntegrationRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  integration: toIntegration(row),
});

const importPayload = (row: ImportRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  issueImport: toIssueImport(row),
});

interface CreateCsvJiraArgs {
  csvUrl: string;
  jiraEmail?: string | null;
  jiraHostname?: string | null;
  jiraToken?: string | null;
  teamId?: string | null;
  teamName?: string | null;
}

// A mapping's parts this instance reads: `people` (source person key → user id or
// null) and, for CSV imports, `statuses` (status value → state id or name).
function mappingParts(mapping: Record<string, unknown> | null | undefined) {
  return {
    people: peopleMapping({ ...((mapping?.people as object | undefined) ?? {}) }),
    statuses: statusMapping(mapping?.statuses),
  };
}

interface CreateGithubArgs {
  githubRepoIds?: number[] | null;
  githubLabels?: string[] | null;
  includeClosedIssues?: boolean | null;
  instantProcess?: boolean | null;
  teamId?: string | null;
  teamName?: string | null;
}

export const issueImportResolvers = {
  Query: {
    // Linear's CSV check: only Jira exports are supported.
    issueImportCheckCSV: (
      _: unknown,
      { csvUrl, service }: { csvUrl: string; service: string },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await assertImporter(ctx);
        if (service !== 'jira') throw new HttpError(400, 'Only jira CSV files are supported');
        await checkJiraCsv(ctx.user.id, csvUrl);
        return { success: true };
      }),
  },
  Mutation: {
    // The Jira credentials are accepted and not used: this instance does not call
    // Jira. The hostname, when given, links each issue back to its Jira page.
    issueImportCreateCSVJira: (_: unknown, args: CreateCsvJiraArgs, ctx: GraphQLContext) =>
      guard(async () => {
        await assertImporter(ctx);
        if (args.teamId && !UUID_RE.test(args.teamId)) throw new HttpError(404, 'Team not found');
        const row = await createCsvImport({
          userId: ctx.user.id,
          assetUrl: args.csvUrl,
          source: 'jira',
          teamId: args.teamId ?? null,
          teamName: args.teamName ?? null,
          jiraHostname: args.jiraHostname,
        });
        return importPayload(row);
      }),

    // Saves the mapping (a full replacement) without starting the import.
    issueImportUpdate: (
      _: unknown,
      { id, input }: { id: string; input: { mapping: Record<string, unknown> } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await assertImporter(ctx);
        const row = await findImport(id);
        // The mapping of an import that ran is the record of what was used.
        if (!isAwaitingPeople(row))
          throw new HttpError(409, 'The import is not waiting for its mapping');
        const parts = mappingParts(input.mapping);
        return importPayload(await setImportMapping(row.id, parts));
      }),

    integrationGithubImportConnect: (
      _: unknown,
      { code, installationId }: { code: string; installationId: string },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await assertImporter(ctx);
        return integrationPayload(await connectGithub(code, installationId, ctx.user.id));
      }),

    // Repositories are read live from the installation, so a refresh checks that the
    // installation still answers.
    integrationGithubImportRefresh: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await assertImporter(ctx);
        const row = UUID_RE.test(id) ? await getIntegration(id) : null;
        if (!row) throw new HttpError(404, 'Integration not found');
        await githubRepositories();
        return integrationPayload(row);
      }),

    issueImportCreateGithub: (_: unknown, args: CreateGithubArgs, ctx: GraphQLContext) =>
      guard(async () => {
        await assertImporter(ctx);
        let teamId: string | null = null;
        let teamName: string | null = null;
        if (args.teamId) {
          if (!UUID_RE.test(args.teamId) || !(await canSeeTeam(args.teamId, ctx.user.id)))
            throw new HttpError(404, 'Team not found');
          teamId = args.teamId;
        } else if (args.teamName?.trim()) {
          teamName = args.teamName.trim();
        } else {
          throw new HttpError(400, 'Provide either teamId or teamName');
        }
        const row = await createGithubImport({
          userId: ctx.user.id,
          repoIds: args.githubRepoIds ?? [],
          labels: (args.githubLabels ?? []).map((l) => l.trim()).filter(Boolean),
          includeClosed: args.includeClosedIssues === true,
          instantProcess: args.instantProcess === true,
          teamId,
          teamName,
        });
        return importPayload(row);
      }),

    // The mapping's `people` and `statuses` (mappingParts); a part left out uses the
    // one saved with issueImportUpdate. Any other mapping key is ignored.
    issueImportProcess: (
      _: unknown,
      { issueImportId, mapping }: { issueImportId: string; mapping: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await assertImporter(ctx);
        const row = await findImport(issueImportId);
        const saved = row.mapping ?? {};
        const { people, statuses } = mappingParts({
          people: mapping?.people ?? saved.people,
          statuses: mapping?.statuses ?? saved.statuses,
        });
        return importPayload(await startProcessing(row, people, statuses));
      }),
  },
  Integration: {
    creator: (i: { creatorId: string | null }, _: unknown, ctx: GraphQLContext) =>
      i.creatorId ? userById(i.creatorId, ctx.user.id) : null,
    organization: () => getOrganization(),
    team: () => null,
  },
};
