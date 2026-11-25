import { db, fileUpload } from '@repo/db';
import { eq } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { deleteObject, getObject } from '../shared/s3';
import { getUpload, isImportFile, uploadIdFromAssetUrl } from './store';

// Import files (./store.ts): a CSV uploaded for an issue import, read back by the
// import and deleted when the import ends.

// The text of the uploader's stored import file an asset URL names, with the SHA-256
// of its bytes (hex). 404 for any other upload, another user's, or one not stored.
export async function readImportFile(
  userId: string,
  assetUrl: string,
): Promise<{ text: string; sha256: string }> {
  const id = uploadIdFromAssetUrl(assetUrl);
  const row = id ? await getUpload(id) : null;
  if (!row || row.userId !== userId || !row.completedAt || !isImportFile(row))
    throw new HttpError(404, 'Import file not found');
  let bytes: Uint8Array;
  try {
    const obj = await getObject(row.objectKey);
    bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  } catch (err) {
    throw new HttpError(502, `Object store error: ${err instanceof Error ? err.message : err}`);
  }
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  };
}

// Deletes an import file and its object (best-effort). Nothing happens for an upload
// that is not an import file.
export async function deleteImportFile(assetUrl: string): Promise<void> {
  const id = uploadIdFromAssetUrl(assetUrl);
  const row = id ? await getUpload(id) : null;
  if (!row || !isImportFile(row)) return;
  await db.delete(fileUpload).where(eq(fileUpload.id, row.id));
  if (!row.completedAt) return;
  await deleteObject(row.objectKey).catch((err) => {
    console.error(
      `[api] failed to delete import file ${row.objectKey}:`,
      err instanceof Error ? err.message : err,
    );
  });
}
