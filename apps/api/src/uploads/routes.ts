import { Elysia, t } from 'elysia';
import { authContext } from '../shared/auth-context';
import { requireUser } from '../shared/access';
import { workerTokenValid } from '../shared/http';
import { HttpError } from '../shared/lib';
import { rawObjectResponse } from '../shared/raw-object';
import { ErrorResponse } from '../shared/responses';
import { getObject } from '../shared/s3';
import { deleteUnusedUploads, getUpload, receiveUpload } from './store';

// Plain HTTP for Linear's fileUpload: the signed upload URL (PUT, the uploader's own
// session or API key) and the asset URL (public GET, like the attachment and avatar
// raw routes). The GraphQL `fileUpload` mutation creates the upload.
export const uploadRoutes = new Elysia({ name: 'uploads', detail: { tags: ['Uploads'] } })
  .use(authContext)
  .put(
    '/uploads/:token',
    async ({ params, request, user }) => {
      const uploader = requireUser(user);
      const body = new Uint8Array(await request.arrayBuffer());
      await receiveUpload(
        params.token,
        uploader.id,
        request.headers.get('content-type') ?? '',
        body,
      );
      return { success: true };
    },
    {
      params: t.Object({ token: t.String({ format: 'uuid' }) }),
      // The body is the file's bytes in its own content type, read raw.
      parse: 'none',
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        410: ErrorResponse,
        413: ErrorResponse,
        502: ErrorResponse,
      },
      detail: { summary: 'Upload the bytes of a file (signed upload URL)' },
    },
  )
  .get(
    '/uploads/:id/raw',
    async ({ params, query }) => {
      const row = await getUpload(params.id);
      if (!row?.completedAt) throw new HttpError(404, 'Upload not found');
      let obj;
      try {
        obj = await getObject(row.objectKey);
      } catch (err) {
        throw new HttpError(404, err instanceof Error ? err.message : 'Object not found');
      }
      return rawObjectResponse(obj, row.contentType, row.filename, query.download != null);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      query: t.Object({ download: t.Optional(t.String()) }),
      response: { 404: ErrorResponse },
      detail: { summary: 'Download or preview an uploaded file (public, no auth)' },
    },
  );

// The worker calls this on its cleanup interval: uploads nothing used within a day
// are deleted.
export const internalUploadRoutes = new Elysia({ name: 'internal-uploads' }).post(
  '/internal/uploads/cleanup',
  async ({ headers, set }) => {
    if (!workerTokenValid(headers)) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    return { removed: await deleteUnusedUploads() };
  },
);
