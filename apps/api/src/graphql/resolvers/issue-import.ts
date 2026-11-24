import { findImport, peopleMapping, startProcessing } from '../../imports/flow';
import {
  connectGithub,
  createGithubImport,
  getIntegration,
  githubRepositories,
  type IntegrationRow,
} from '../../imports/github';
import type { ImportRow } from '../../imports/store';
import { atLeast, canSeeTeam, workspaceRole } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { userById } from './issue';
import { guard, lastSyncId } from './mutations';
import { getOrganization } from './organization';

// Linear's IssueImport from an import job (apps/api/src/imports). It is reached
// through IssueImportPayload and IssueHistory.issueImport; the job never holds a token.
export function toIssueImport(row: ImportRow) {
  return {
    id: row.id,
    service: row.service,
    status: row.status,
    progress: row.progress,
    displayName: row.displayName,
    teamName: row.teamName,
    creatorId: row.creatorId,
    serviceMetadata: row.serviceMetadata ?? null,
    mapping: row.mapping ?? null,
    error: row.error,
    errorMetadata: null,
    csvFileUrl: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
  };
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

interface CreateGithubArgs {
  githubRepoIds?: number[] | null;
  githubLabels?: string[] | null;
  includeClosedIssues?: boolean | null;
  instantProcess?: boolean | null;
  teamId?: string | null;
  teamName?: string | null;
}

export const issueImportResolvers = {
  Mutation: {
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

    // The mapping's `people` (source person key → user id or null) is the people
    // matching; any other mapping key is ignored.
    issueImportProcess: (
      _: unknown,
      { issueImportId, mapping }: { issueImportId: string; mapping: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        await assertImporter(ctx);
        const row = await findImport(issueImportId);
        const people = peopleMapping({ ...((mapping?.people as object | undefined) ?? {}) });
        return importPayload(await startProcessing(row, people));
      }),
  },
  Integration: {
    creator: (i: { creatorId: string }, _: unknown, ctx: GraphQLContext) =>
      userById(i.creatorId, ctx.user.id),
    organization: () => getOrganization(),
    team: () => null,
  },
};
