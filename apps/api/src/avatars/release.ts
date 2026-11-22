import { deleteObject } from '../shared/s3';
import { setUploadUsed, uploadIdFromAssetUrl } from '../uploads/store';

// An avatar is either a REST-uploaded object (`/avatars/<id>/raw`, object
// `avatars/<id>`) or a fileUpload asset (`/uploads/<id>/raw`). When a user's avatar is
// replaced or cleared, whichever path the previous image came from is released: the
// REST object is deleted, the upload is marked unused for the daily sweep.

export const avatarKey = (id: string) => `avatars/${id}`;

// The avatar id of a stored `/avatars/<id>/raw` image, or null when it is not one.
export function avatarIdFromImage(image: string | null | undefined): string | null {
  if (!image) return null;
  const match = image.match(/\/avatars\/([^/]+)\/raw$/);
  return match ? match[1]! : null;
}

export async function releaseAvatarImage(image: string | null | undefined): Promise<void> {
  if (!image) return;
  const uploadId = uploadIdFromAssetUrl(image);
  if (uploadId) {
    await setUploadUsed(uploadId, false);
    return;
  }
  const id = avatarIdFromImage(image);
  if (!id) return;
  await deleteObject(avatarKey(id)).catch((err) => {
    console.error(
      `[planner] failed to delete previous avatar ${id}:`,
      err instanceof Error ? err.message : err,
    );
  });
}
