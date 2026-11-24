import { Elysia, t } from 'elysia';
import { randomUUID } from 'node:crypto';
import { noContent } from '../shared/http';
import { authContext } from '../shared/auth-context';
import { entityGuard } from '../shared/guards';
import { HttpError } from '../shared/lib';
import { putObject, getObject } from '../shared/s3';
import { assertPublicHttpUrl } from '../shared/net';
import { getIssueTeamId } from '../issues/store';
import { ErrorResponse } from '../shared/responses';
import { rawObjectResponse } from '../shared/raw-object';
import { getStorageSettings, MB } from '../settings/storage';
import {
  assertUploadAllowed,
  createAttachment,
  listAttachments,
  getAttachmentByPublicId,
  deleteAttachment,
  type AttachmentRow,
} from './store';

// Wire shape produced by attachmentDto (see there for what it omits).
const AttachmentSchema = t.Object({
  id: t.String(),
  filename: t.String(),
  contentType: t.String(),
  sizeBytes: t.Number(),
  createdAt: t.String(),
  url: t.String(),
});

// Object keys are grouped by team so a team's bytes sit under one prefix in
// the bucket, which is what makes per-team listing, cleanup, and policies
// possible. Keys already stored keep their old form; the full key lives in the row.
function attachmentKey(teamId: string, issueId: string, filename: string): string {
  // Keep the original filename as the last key segment so the extension is visible
  // in the bucket and to any tool that sniffs the key by suffix.
  const safeName = filename.replace(/[^\w.-]+/g, '_').slice(-100);
  return `teams/${teamId}/attachments/${issueId}/${randomUUID()}-${safeName}`;
}

// Public shape returned to the UI: never exposes the internal serial id or the
// object key. `url` is the public, no-auth download route — it can be embedded in
// an issue description and fetched by external services.
function attachmentDto(a: AttachmentRow) {
  return {
    id: a.publicId!,
    filename: a.filename!,
    contentType: a.contentType!,
    sizeBytes: a.sizeBytes!,
    createdAt: a.createdAt,
    url: a.url,
  };
}

const issueParams = t.Object({ issueId: t.String({ format: 'uuid' }) });

export const attachmentRoutes = new Elysia({
  name: 'attachments',
  detail: { tags: ['Attachments'] },
})
  .use(authContext)
  // Guards for the attachment routes, keyed by how they address the work item:
  // `issueAttachment` for /issues/:issueId/attachments, `attachment` for
  // /attachments/:publicId. Both assert a work_items action on the owning team.
  .macro({
    issueAttachment: entityGuard('Issue not found', (p) => getIssueTeamId(p.issueId)),
    attachment: entityGuard('Attachment not found', async (p) => {
      const existing = await getAttachmentByPublicId(p.publicId);
      if (!existing) return null;
      return getIssueTeamId(existing.issueId);
    }),
  })
  .get(
    '/issues/:issueId/attachments',
    async ({ params }) => {
      const rows = await listAttachments(params.issueId);
      return rows.map(attachmentDto);
    },
    {
      params: issueParams,
      issueAttachment: 'see',
      response: {
        200: t.Array(AttachmentSchema),
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'List attachments',
        description: "List an issue's attachments by its id (a UUID).",
      },
    },
  )

  // Accepts a multipart form with a single "file" field, stores the bytes in the
  // object store, and records the metadata. Returns the attachment DTO.
  .post(
    '/issues/:issueId/attachments',
    async ({ params, body, set, teamId, user }) => {
      const issueId = params.issueId;
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded (form field "file")');
      if (file.size === 0) throw new HttpError(400, 'Uploaded file is empty');

      const filename = file.name || 'file';
      const contentType = file.type || 'application/octet-stream';
      await assertUploadAllowed(await getStorageSettings(), teamId, file.size, contentType);

      const key = attachmentKey(teamId, issueId, filename);
      const bytes = Buffer.from(await file.arrayBuffer());

      try {
        await putObject(key, bytes, contentType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[planner] object store PUT failed (bucket=${process.env.S3_BUCKET}, key=${key}, size=${file.size}):`,
          err,
        );
        throw new HttpError(502, `Object store error: ${msg}`);
      }

      const row = await createAttachment({
        issueId,
        s3Key: key,
        filename,
        contentType,
        sizeBytes: file.size,
        creatorUserId: user?.id ?? null,
      });
      set.status = 201;
      return attachmentDto(row);
    },
    {
      body: t.Object({ file: t.File() }),
      params: issueParams,
      issueAttachment: 'see',
      response: {
        201: AttachmentSchema,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        413: ErrorResponse,
        502: ErrorResponse,
      },
      detail: { summary: 'Upload an attachment' },
    },
  )

  // Adds an attachment from a URL or inline base64, for callers that cannot send a
  // multipart file (internal agents). Exactly one of url / contentBase64 is given.
  // A URL is fetched server-side, so it is SSRF-guarded (https only in prod, no
  // private/local hosts, no redirects) and size-capped like a direct upload.
  .post(
    '/issues/:issueId/attachments/import',
    async ({ params, body, set, teamId, user }) => {
      const issueId = params.issueId;
      const { filename, url, contentBase64 } = body;
      if ((url == null) === (contentBase64 == null)) {
        throw new HttpError(400, 'Provide exactly one of url or contentBase64');
      }
      const limits = await getStorageSettings();

      let bytes: Buffer;
      let contentType: string;
      if (url != null) {
        const target = await assertPublicHttpUrl(url);
        let res: Response;
        try {
          res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        } catch {
          throw new HttpError(400, 'Could not fetch the url');
        }
        if (res.status >= 300 && res.status < 400) {
          throw new HttpError(400, 'The url redirects; provide the final url');
        }
        if (!res.ok) throw new HttpError(400, `Could not fetch the url (status ${res.status})`);
        const declared = Number(res.headers.get('content-length') ?? '');
        if (declared && declared > limits.maxAttachmentMb * MB) {
          throw new HttpError(413, `File exceeds the ${limits.maxAttachmentMb} MB limit`);
        }
        bytes = Buffer.from(await res.arrayBuffer());
        contentType =
          body.contentType ||
          res.headers.get('content-type')?.split(';')[0]?.trim() ||
          'application/octet-stream';
      } else {
        bytes = Buffer.from(contentBase64 as string, 'base64');
        if (bytes.length === 0)
          throw new HttpError(400, 'contentBase64 is empty or not valid base64');
        contentType = body.contentType || 'application/octet-stream';
      }

      if (bytes.length === 0) throw new HttpError(400, 'The file is empty');
      await assertUploadAllowed(limits, teamId, bytes.length, contentType);

      const key = attachmentKey(teamId, issueId, filename);
      try {
        await putObject(key, bytes, contentType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[planner] object store PUT failed (key=${key}, size=${bytes.length}):`, err);
        throw new HttpError(502, `Object store error: ${msg}`);
      }

      const row = await createAttachment({
        issueId,
        s3Key: key,
        filename,
        contentType,
        sizeBytes: bytes.length,
        creatorUserId: user?.id ?? null,
      });
      set.status = 201;
      return attachmentDto(row);
    },
    {
      params: issueParams,
      body: t.Object({
        filename: t.String({ minLength: 1 }),
        url: t.Optional(t.String()),
        contentBase64: t.Optional(t.String()),
        contentType: t.Optional(t.String()),
      }),
      issueAttachment: 'see',
      response: {
        201: AttachmentSchema,
        400: ErrorResponse,
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
        413: ErrorResponse,
        502: ErrorResponse,
      },
      detail: {
        summary: 'Add an attachment from a URL or base64',
        description: 'Attach a file to an issue without a multipart upload.',
      },
    },
  )

  .delete(
    '/attachments/:publicId',
    async ({ params, user }) => {
      const existing = await getAttachmentByPublicId(params.publicId);
      if (!existing) throw new HttpError(404, 'Attachment not found');
      // Removes the row, the file's embeds in the issue and the stored object.
      await deleteAttachment(existing.id, user?.id ?? null);
      return noContent();
    },
    {
      attachment: 'see',
      response: {
        204: t.Void(),
        401: ErrorResponse,
        403: ErrorResponse,
        404: ErrorResponse,
      },
      detail: {
        summary: 'Delete an attachment',
        description: 'Delete an attachment. Irreversible.',
      },
    },
  )

  // Public download/preview URL: unauthenticated so it works in <img>/<video>
  // tags and can be fetched by external services. The publicId is an unguessable
  // uuid. `?download=1` forces a download instead of inline rendering.
  .get(
    '/attachments/:publicId/raw',
    async ({ params, query }) => {
      const row = await getAttachmentByPublicId(params.publicId);
      if (!row) throw new HttpError(404, 'Attachment not found');

      let obj;
      try {
        obj = await getObject(row.s3Key!);
      } catch (err) {
        throw new HttpError(404, err instanceof Error ? err.message : 'Object not found');
      }

      return rawObjectResponse(obj, row.contentType!, row.filename!, query.download != null);
    },
    {
      query: t.Object({ download: t.Optional(t.String()) }),
      // Public route: no 401/403. Returns a raw Response (bytes), so no typed 200
      // body — Elysia cannot validate a raw Response. Only the 404 it can throw.
      response: {
        404: ErrorResponse,
      },
      detail: { summary: 'Download or preview an attachment (public, no auth)' },
    },
  );
