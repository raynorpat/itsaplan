import { db, fileUpload } from '@repo/db';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { deleteObject, putObject } from '../shared/s3';
import { AVATAR_IMAGE_TYPES, getStorageSettings, MB, mimeAllowed } from '../settings/storage';

// Linear's fileUpload. A request reserves an upload (uploader, content type, size,
// object key) and returns a signed URL: PUT the bytes to `/uploads/<token>` with the
// declared Content-Type, once, within UPLOAD_TTL_MS. As in Linear, the token in the URL
// is the credential for the PUT; using the stored file (an attachment, an avatar)
// needs the uploader's own session. The asset URL `/uploads/<id>/raw` then names the
// stored object. The request accepts what either use allows; the use checks its own
// limits (attachments: attachments/store, avatars: the userUpdate resolver) and claims
// the upload, so one upload backs one attachment or one avatar. An upload nothing uses
// within a day is deleted.

export const UPLOAD_TTL_MS = 10 * 60 * 1000;
const UNUSED_UPLOAD_MS = 24 * 60 * 60 * 1000;
// A user's unused uploads (requested or stored, not yet attached or an avatar) may
// total at most this many attachment-size limits, so unused uploads cannot serve as
// unbounded file hosting before the daily sweep.
const UNUSED_UPLOAD_LIMITS = 10;

export type UploadRow = typeof fileUpload.$inferSelect;

const apiOrigin = () => (process.env.API_URL ?? '').replace(/\/+$/, '');

export const uploadUrlOf = (row: UploadRow) => `${apiOrigin()}/uploads/${row.token}`;
export const assetPathOf = (row: Pick<UploadRow, 'id'>) => `/uploads/${row.id}/raw`;
export const assetUrlOf = (row: Pick<UploadRow, 'id'>) => `${apiOrigin()}${assetPathOf(row)}`;

const baseType = (contentType: string) => contentType.split(';')[0]?.trim().toLowerCase() ?? '';

// The id of the upload an asset URL names (absolute on the API origin, or the path),
// or null when the URL is not an upload asset.
export function uploadIdFromAssetUrl(url: string): string | null {
  let path = url;
  const origin = apiOrigin();
  if (origin && url.startsWith(origin)) path = url.slice(origin.length);
  const match = /^\/uploads\/([0-9a-f-]{36})\/raw$/i.exec(path);
  return match ? match[1]!.toLowerCase() : null;
}

export async function requestUpload(input: {
  userId: string;
  contentType: string;
  filename: string;
  size: number;
  metaData?: Record<string, unknown> | null;
}): Promise<UploadRow> {
  const contentType = baseType(input.contentType);
  const filename = input.filename.trim();
  if (!contentType) throw new HttpError(400, 'contentType is required');
  if (!filename || filename.length > 255)
    throw new HttpError(400, 'filename must be 1–255 characters');
  if (!Number.isInteger(input.size) || input.size <= 0)
    throw new HttpError(400, 'size must be a positive number of bytes');
  const limits = await getStorageSettings();
  const asAvatar = AVATAR_IMAGE_TYPES.test(contentType) && input.size <= limits.maxAvatarMb * MB;
  const asAttachment =
    mimeAllowed(contentType, limits.attachmentMimeTypes) &&
    input.size <= limits.maxAttachmentMb * MB;
  if (!asAvatar && !asAttachment)
    throw new HttpError(400, `A ${contentType} file of ${input.size} bytes is not accepted`);
  const [unused] = await db
    .select({ total: sql<string>`coalesce(sum(${fileUpload.size}), 0)` })
    .from(fileUpload)
    .where(and(eq(fileUpload.userId, input.userId), isNull(fileUpload.usedAt)));
  if (Number(unused?.total ?? 0) + input.size > UNUSED_UPLOAD_LIMITS * limits.maxAttachmentMb * MB)
    throw new HttpError(400, 'Too many unused uploads; use or wait for earlier uploads first');
  const safeName = filename.replace(/[^\w.-]+/g, '_').slice(-100);
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(fileUpload)
    .values({
      id,
      userId: input.userId,
      contentType,
      filename,
      size: input.size,
      objectKey: `uploads/${id}/${safeName}`,
      metaData: input.metaData ? JSON.parse(JSON.stringify(input.metaData)) : null,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    })
    .returning();
  return row!;
}

// Checks a PUT to an upload URL before its body is read: 404 for an unknown token, 410
// for a used or expired one, 400 for a different content type, 413 when the declared
// Content-Length is larger than the reserved size.
export async function checkUploadRequest(
  token: string,
  contentType: string,
  contentLength: number | null,
): Promise<UploadRow> {
  const [row] = await db.select().from(fileUpload).where(eq(fileUpload.token, token));
  if (!row) throw new HttpError(404, 'Upload not found');
  if (row.completedAt || row.expiresAt.getTime() < Date.now())
    throw new HttpError(410, 'This upload URL has been used or has expired');
  if (baseType(contentType) !== row.contentType)
    throw new HttpError(400, `Content-Type must be ${row.contentType}`);
  if (contentLength != null && contentLength > row.size)
    throw new HttpError(413, 'The upload is larger than declared');
  return row;
}

// Stores the bytes of a PUT to an upload URL checked by checkUploadRequest: 400 for an
// empty body, 413 for more bytes than declared, 410 when another PUT claimed it first.
// The URL is claimed (expired) before storing, so two PUTs cannot both store, and the
// upload counts as stored only once the object is written: a failed write leaves the
// URL used and nothing referenceable.
export async function receiveUpload(row: UploadRow, body: Uint8Array): Promise<UploadRow> {
  if (body.length === 0) throw new HttpError(400, 'The upload is empty');
  if (body.length > row.size) throw new HttpError(413, 'The upload is larger than declared');
  const [claimed] = await db
    .update(fileUpload)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(
      and(
        eq(fileUpload.id, row.id),
        isNull(fileUpload.completedAt),
        sql`${fileUpload.expiresAt} > now()`,
      ),
    )
    .returning();
  if (!claimed) throw new HttpError(410, 'This upload URL has been used or has expired');
  try {
    await putObject(row.objectKey, Buffer.from(body), row.contentType);
  } catch (err) {
    throw new HttpError(502, `Object store error: ${err instanceof Error ? err.message : err}`);
  }
  const [stored] = await db
    .update(fileUpload)
    .set({ completedAt: sql`now()`, size: body.length })
    .where(eq(fileUpload.id, row.id))
    .returning();
  return stored!;
}

export async function getUpload(id: string): Promise<UploadRow | null> {
  const [row] = await db.select().from(fileUpload).where(eq(fileUpload.id, id));
  return row ?? null;
}

// The stored, still unused upload an asset URL names, when it belongs to `userId`;
// otherwise null.
export async function ownStoredUpload(url: string, userId: string): Promise<UploadRow | null> {
  const id = uploadIdFromAssetUrl(url);
  if (!id) return null;
  const row = await getUpload(id);
  return row && row.userId === userId && row.completedAt && !row.usedAt ? row : null;
}

// Claims a stored upload of `userId` for one use (an attachment or an avatar). Returns
// false when it is not theirs, not stored, or already used.
export async function claimUpload(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .update(fileUpload)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(fileUpload.id, id),
        eq(fileUpload.userId, userId),
        isNotNull(fileUpload.completedAt),
        isNull(fileUpload.usedAt),
      ),
    )
    .returning({ id: fileUpload.id });
  return !!row;
}

// Marks an upload as used (kept) or no longer used (deleted by the next sweep after a
// day).
export async function setUploadUsed(id: string, used: boolean): Promise<void> {
  await db
    .update(fileUpload)
    .set({ usedAt: used ? sql`now()` : null })
    .where(eq(fileUpload.id, id));
}

// Deletes uploads nothing used within a day of their request; their objects go
// best-effort. Returns how many were removed.
export async function deleteUnusedUploads(now = new Date()): Promise<number> {
  const stale = await db
    .delete(fileUpload)
    .where(
      and(
        isNull(fileUpload.usedAt),
        lt(fileUpload.createdAt, new Date(now.getTime() - UNUSED_UPLOAD_MS)),
      ),
    )
    .returning();
  for (const row of stale) {
    if (!row.completedAt) continue;
    await deleteObject(row.objectKey).catch((err) => {
      console.error(
        `[planner] failed to delete unused upload ${row.objectKey}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
  return stale.length;
}
