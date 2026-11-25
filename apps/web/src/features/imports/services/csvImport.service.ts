'use client';

import { useQuery } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { uploadToStorage } from '@/services/uploads.service';
import type { ColumnMapping, StateChoice } from '../utils/csvImport';
import type { ImportDestination, ImportView } from '../utils/imports';

// CSV imports through /api/auth/instance/imports/csv/*: the file is stored as an import
// file (fileUpload with `purpose: import`), read back as a preview with guessed
// columns, then started as a Jira or generic CSV import. Plain calls, so the form shows
// the errors itself.

export interface CsvPreview {
  headers: string[];
  sample: string[][];
  rows: number;
  guess: ColumnMapping;
  jira: boolean;
}

export type CsvSourceKind = 'jira' | 'generic';

// Browsers often give a CSV no type or Excel's; the API accepts those, and an empty
// type is sent as text/csv (fileUpload's content type cannot be empty).
export function uploadImportFile(file: File): Promise<string> {
  return uploadToStorage(file, file.type || 'text/csv', { purpose: 'import' });
}

export function previewCsv(assetUrl: string): Promise<CsvPreview> {
  return instanceFetch<CsvPreview>('/instance/imports/csv/preview', {
    method: 'POST',
    body: { assetUrl },
  });
}

export function startCsvImport(input: {
  assetUrl: string;
  source: CsvSourceKind;
  mapping: ColumnMapping | null;
  destination: ImportDestination;
}): Promise<ImportView> {
  return instanceFetch<{ import: ImportView }>('/instance/imports/csv/create', {
    method: 'POST',
    body: {
      assetUrl: input.assetUrl,
      source: input.source,
      ...(input.mapping ? { mapping: input.mapping } : {}),
      teamId: input.destination.teamId,
      teamName: input.destination.teamName,
    },
  }).then((r) => r.import);
}

const TeamStatesQuery = graphql(`
  query ImportTeamStates($id: String!) {
    team(id: $id) {
      states(first: 250) {
        nodes {
          id
          name
          type
          position
        }
      }
    }
  }
`);

// The destination team's states for the statuses step; null for an import into a new
// team, whose default states the step offers by name.
export function useImportTeamStatesQuery(teamId: string | null) {
  return useQuery({
    queryKey: qk.importTeamStates(teamId ?? ''),
    queryFn: async (): Promise<StateChoice[]> =>
      (await gqlRequest(TeamStatesQuery, { id: teamId! })).team.states.nodes,
    enabled: teamId != null,
  });
}
