import { deleteImportFile } from '../uploads/import-files';
import type { ImportRow } from './store';

// A CSV import's file (serviceMetadata.csvUrl) is kept while the import may still read
// it and deleted when the import ends: completed, failed, expired or interrupted.
export async function releaseImportFile(row: Pick<ImportRow, 'serviceMetadata'>): Promise<void> {
  const url = row.serviceMetadata?.csvUrl;
  if (typeof url === 'string') await deleteImportFile(url);
}
