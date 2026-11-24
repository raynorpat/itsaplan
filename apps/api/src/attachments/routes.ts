import { Elysia, t } from 'elysia';
import { HttpError } from '../shared/lib';
import { getObject } from '../shared/s3';
import { rawObjectResponse } from '../shared/raw-object';
import { getAttachmentByPublicId } from './store';

// Public download/preview URL of an uploaded attachment: unauthenticated so it works
// in <img>/<video> tags and can be fetched by external services. The publicId is an
// unguessable uuid. `?download=1` forces a download instead of inline rendering.
export const attachmentFileRoutes = new Elysia({ name: 'attachment-files' }).get(
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
  { query: t.Object({ download: t.Optional(t.String()) }) },
);
