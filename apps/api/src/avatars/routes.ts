import { Elysia, t } from 'elysia';
import { HttpError } from '../shared/lib';
import { getObject } from '../shared/s3';
import { avatarKey } from './release';

// Public preview URL of a user's avatar (`user.image` holds `/avatars/<id>/raw`):
// unauthenticated so it works in an <img> tag. The id is an unguessable uuid. Only
// raster image types are stored, and nosniff plus the media check keep the bytes from
// being interpreted as anything executable. Avatars are uploaded through Linear's
// `fileUpload` and set with `userUpdate({ avatarUrl })`.
export const avatarFileRoutes = new Elysia({ name: 'avatar-files' }).get(
  '/avatars/:id/raw',
  async ({ params }) => {
    let obj;
    try {
      obj = await getObject(avatarKey(params.id));
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : 'Object not found');
    }
    const ct = /^image\//i.test(obj.contentType) ? obj.contentType : 'application/octet-stream';
    const headers: Record<string, string> = {
      'Content-Type': ct,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (obj.contentLength != null) headers['Content-Length'] = String(obj.contentLength);
    return new Response(obj.body, { headers });
  },
  { params: t.Object({ id: t.String() }) },
);
