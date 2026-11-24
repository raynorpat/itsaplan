import { db, integration } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { beginFetch } from './flow';
import {
  confirmInstallation,
  fetchGithub,
  githubConfig,
  listGithubRepos,
  requireGithubConfig,
  type GithubRepository,
} from './sources/github';
import { createImport, type ImportRow } from './store';

// GitHub issue imports through Linear's import model: the workspace connects this
// instance's GitHub Import App (integrationGithubImportConnect), then
// issueImportCreateGithub fetches the chosen repositories and issueImportProcess
// processes them with the people mapping. The connection is the one `integration`
// row of service `githubImport`; it stores the installation id, never a token.

export const GITHUB_IMPORT_SERVICE = 'githubImport';

export type IntegrationRow = typeof integration.$inferSelect;

export async function githubIntegration(): Promise<IntegrationRow | null> {
  const [row] = await db
    .select()
    .from(integration)
    .where(eq(integration.service, GITHUB_IMPORT_SERVICE));
  return row ?? null;
}

export async function getIntegration(id: string): Promise<IntegrationRow | null> {
  const [row] = await db.select().from(integration).where(eq(integration.id, id));
  return row ?? null;
}

// Connects (or replaces) the workspace's GitHub Import App installation after GitHub
// confirms the person can access it.
export async function connectGithub(
  code: string,
  installationId: string,
  userId: string,
): Promise<IntegrationRow> {
  if (!/^[1-9]\d*$/.test(installationId))
    throw new HttpError(400, 'installationId must be a positive integer');
  await confirmInstallation(code, installationId);
  const [row] = await db
    .insert(integration)
    .values({ service: GITHUB_IMPORT_SERVICE, installationId, creatorId: userId })
    .onConflictDoUpdate({
      target: integration.service,
      set: { installationId, creatorId: userId, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function disconnectGithub(): Promise<void> {
  await db.delete(integration).where(eq(integration.service, GITHUB_IMPORT_SERVICE));
}

async function connectedInstallation(): Promise<string> {
  requireGithubConfig();
  const row = await githubIntegration();
  if (!row) throw new HttpError(400, 'Connect GitHub before importing');
  return row.installationId;
}

export async function githubRepositories(): Promise<GithubRepository[]> {
  return listGithubRepos(await connectedInstallation());
}

// What the Import page needs to offer GitHub: whether the app is configured, its slug
// (for the install link) and the connection.
export async function githubStatus() {
  const config = githubConfig();
  const row = config ? await githubIntegration() : null;
  return {
    configured: config !== null,
    appSlug: config?.appSlug ?? null,
    integration: row
      ? { id: row.id, installationId: row.installationId, createdAt: row.createdAt.toISOString() }
      : null,
  };
}

// Linear's issueImportCreateGithub: an import of the chosen repositories into a team
// (or a team created by name), fetched in the background. With `instantProcess` the
// suggested people matching is applied and processing starts once the fetch ends.
export async function createGithubImport(input: {
  userId: string;
  repoIds: number[];
  labels: string[];
  includeClosed: boolean;
  instantProcess: boolean;
  teamId: string | null;
  teamName: string | null;
}): Promise<ImportRow> {
  const installationId = await connectedInstallation();
  if (input.repoIds.length === 0) throw new HttpError(400, 'githubRepoIds must name a repository');
  const available = await listGithubRepos(installationId);
  const repositories = input.repoIds.map((id) => {
    const repo = available.find((r) => r.id === id);
    if (!repo) throw new HttpError(400, `The GitHub Import App cannot see repository ${id}`);
    return repo;
  });
  const row = await createImport({
    service: 'github',
    teamId: input.teamId,
    teamName: input.teamName,
    creatorId: input.userId,
    displayName: repositories.map((r) => r.name).join(', '),
    serviceMetadata: {
      service: 'GitHub',
      repositories: repositories.map((r) => ({ id: r.id, name: r.name })),
      includeClosed: input.includeClosed,
      labels: input.labels,
    },
  });
  beginFetch(
    row,
    () =>
      fetchGithub(installationId, repositories, {
        includeClosed: input.includeClosed,
        labels: input.labels,
      }),
    { instantProcess: input.instantProcess },
  );
  return row;
}
