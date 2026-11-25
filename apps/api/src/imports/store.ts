import { db, issueImport } from '@repo/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { releaseImportFile } from './files';
import type { ImportStatus, ImportSummary } from './types';

// Import jobs (Linear's IssueImport). A row never holds a source token.

export type ImportRow = typeof issueImport.$inferSelect;

export const INTERRUPTED = 'Interrupted, run the import again';

export async function createImport(input: {
  service: string;
  teamId?: string | null;
  teamName?: string | null;
  creatorId: string;
  displayName: string;
  serviceMetadata: Record<string, unknown>;
}): Promise<ImportRow> {
  const [row] = await db
    .insert(issueImport)
    .values({
      service: input.service,
      status: 'inProgress',
      progress: 0,
      teamId: input.teamId ?? null,
      teamName: input.teamId ? null : (input.teamName ?? null),
      creatorId: input.creatorId,
      displayName: input.displayName,
      serviceMetadata: input.serviceMetadata,
    })
    .returning();
  return row!;
}

export async function getImport(id: string): Promise<ImportRow | null> {
  const [row] = await db.select().from(issueImport).where(eq(issueImport.id, id));
  return row ?? null;
}

// Every import, newest first.
export async function listImports(): Promise<ImportRow[]> {
  return db.select().from(issueImport).orderBy(desc(issueImport.createdAt));
}

export async function setImportStatus(
  id: string,
  status: ImportStatus,
  extra: {
    error?: string | null;
    summary?: ImportSummary;
    mapping?: Record<string, unknown>;
    progress?: number;
    teamId?: string;
  } = {},
): Promise<void> {
  await db
    .update(issueImport)
    .set({
      status,
      ...(extra.error !== undefined ? { error: extra.error } : {}),
      ...(extra.summary ? { summary: { ...extra.summary } } : {}),
      ...(extra.mapping ? { mapping: extra.mapping } : {}),
      ...(extra.progress !== undefined ? { progress: extra.progress } : {}),
      ...(extra.teamId ? { teamId: extra.teamId } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(issueImport.id, id));
}

export async function setImportProgress(
  id: string,
  progress: number,
  summary?: ImportSummary,
): Promise<void> {
  await db
    .update(issueImport)
    .set({
      progress,
      ...(summary ? { summary: { ...summary } } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(issueImport.id, id));
}

// Saves an import's mapping (Linear's issueImportUpdate, a full replacement).
export async function setImportMapping(
  id: string,
  mapping: Record<string, unknown>,
): Promise<ImportRow> {
  const [row] = await db
    .update(issueImport)
    .set({ mapping, updatedAt: sql`now()` })
    .where(eq(issueImport.id, id))
    .returning();
  return row!;
}

// Claims a fetched import for processing: `inProgress` → `inProcess` in one statement,
// so only one request starts it. Null when it was not waiting. A second running import
// into the same team fails on `issue_import_team_in_process_uq` (unique violation).
export async function claimForProcessing(id: string): Promise<ImportRow | null> {
  const [row] = await db
    .update(issueImport)
    .set({ status: 'inProcess', progress: 0, updatedAt: sql`now()` })
    .where(and(eq(issueImport.id, id), eq(issueImport.status, 'inProgress')))
    .returning();
  return row ?? null;
}

// Records (or clears, with null) until when the fetch waits for the source's rate
// limit, as `serviceMetadata.waitingUntil`; the Import page shows it.
export async function setWaitingUntil(id: string, until: Date | null): Promise<void> {
  await db
    .update(issueImport)
    .set({
      serviceMetadata:
        until === null
          ? sql`coalesce(${issueImport.serviceMetadata}, '{}'::jsonb) - 'waitingUntil'`
          : sql`coalesce(${issueImport.serviceMetadata}, '{}'::jsonb) || jsonb_build_object('waitingUntil', ${until.toISOString()}::text)`,
      updatedAt: sql`now()`,
    })
    .where(eq(issueImport.id, id));
}

// Run on API startup: an import running when the process stopped cannot continue
// (its token was in memory), so it ends as an error; running it again skips what came
// across.
export async function sweepInterruptedImports(): Promise<void> {
  const ended = await db
    .update(issueImport)
    .set({ status: 'error', error: INTERRUPTED, updatedAt: sql`now()` })
    .where(inArray(issueImport.status, ['inProgress', 'inProcess']))
    .returning({ serviceMetadata: issueImport.serviceMetadata });
  for (const row of ended) await releaseImportFile(row);
}
