import type { ImportRow } from '../../imports/store';

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
