import { Elysia, t } from 'elysia';
import { workerTokenValid } from '../shared/http';
import { HttpError } from '../shared/lib';
import { rawObjectResponse } from '../shared/raw-object';
import { getObject } from '../shared/s3';
import { checkUploadRequest, deleteUnusedUploads, getUpload, receiveUpload } from './store';

// Plain HTTP for Linear's fileUpload: the signed upload URL (PUT; the token in the URL
// is the credential, as in Linear) and the asset URL (public GET, like the attachment
// and avatar raw routes). The GraphQL `fileUpload` mutation creates the upload.
export const uploadRoutes = new Elysia({ name: 'uploads' })
  .put(
    '/uploads/:token',
    async ({ params, request }) => {
      const length = request.headers.get('content-length');
      // Checked before the body is read, so an oversize body is refused unbuffered.
      const row = await checkUploadRequest(
        params.token,
        request.headers.get('content-type') ?? '',
        length != null && /^\d+$/.test(length) ? Number(length) : null,
      );
      await receiveUpload(row, new Uint8Array(await request.arrayBuffer()));
      return { success: true };
    },
    {
      params: t.Object({ token: t.String({ format: 'uuid' }) }),
      // The body is the file's bytes in its own content type, read raw.
      parse: 'none',
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
