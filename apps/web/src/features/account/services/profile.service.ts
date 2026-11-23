import { gqlRequest, graphql } from '@/lib/graphql';
import { uploadToStorage } from '@/services/uploads.service';

// The avatar the Linear way: the image is stored through fileUpload, then userUpdate
// sets avatarUrl to it. The API checks the type and the avatar limit and releases the
// previous image; the caller reads the session again to render the new one.

const AvatarUpdate = graphql(`
  mutation AvatarUpdate($id: String!, $input: UserUpdateInput!) {
    userUpdate(id: $id, input: $input) {
      success
    }
  }
`);

export async function uploadAvatar(file: File): Promise<void> {
  const avatarUrl = await uploadToStorage(file, file.type || 'application/octet-stream');
  await gqlRequest(AvatarUpdate, { id: 'me', input: { avatarUrl } });
}

export async function removeAvatar(): Promise<void> {
  await gqlRequest(AvatarUpdate, { id: 'me', input: { avatarUrl: null } });
}
