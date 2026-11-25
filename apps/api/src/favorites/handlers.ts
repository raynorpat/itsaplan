import { getActiveSession, type FavoritesHandlers } from '@repo/auth';
import { HttpError } from '../shared/lib';
import { deleteFolderKeepingFavorites } from './store';

// The instance plugin's favorites endpoint: deleting a folder while keeping its
// favorites (/api/auth/instance/favorites/delete-folder), which Linear's API lacks.

async function signedIn(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return session.user;
}

export const favoritesHandlers: FavoritesHandlers = {
  deleteFolder: async (headers, body) => {
    const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined;
    await deleteFolderKeepingFavorites(await signedIn(headers), id);
    return { success: true };
  },
};
