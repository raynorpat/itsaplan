import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { AVATAR_IMAGE_TYPES, getStorageSettings, MB } from '../../settings/storage';
import {
  assetPathOf,
  assetUrlOf,
  ownStoredUpload,
  requestUpload,
  setUploadUsed,
  uploadIdFromAssetUrl,
  uploadUrlOf,
} from '../../uploads/store';
import { getPreferences, isValidTimezone, updatePreferences } from '../../user-preferences/store';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { guard, lastSyncId, onlySupported } from './mutations';
import { toGraphQLUser } from './user';

// Linear's fileUpload (the signed upload URL; the bytes go to the plain HTTP PUT in
// ../../uploads/routes.ts) and userUpdate for the signed-in user's own name, time zone
// and avatar. An avatar must be the user's own stored upload of a raster image within
// the avatar limit.

type UserUpdateInput = Record<string, unknown> & {
  name?: string;
  timezone?: string;
  avatarUrl?: string | null;
};

async function userRow(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row!;
}

// The upload behind a stored avatar image, when the avatar is one.
const avatarUploadId = (image: string | null | undefined) =>
  image ? uploadIdFromAssetUrl(image) : null;

export const uploadResolvers = {
  User: {
    timezone: async (u: { id: string }) => (await getPreferences(u.id)).timezone,
  },
  Mutation: {
    fileUpload: (
      _: unknown,
      args: {
        contentType: string;
        filename: string;
        size: number;
        makePublic?: boolean | null;
        metaData?: Record<string, unknown> | null;
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const row = await requestUpload({
          userId: ctx.user.id,
          contentType: args.contentType,
          filename: args.filename,
          size: args.size,
          metaData: args.metaData ?? null,
        });
        return {
          success: true,
          lastSyncId: lastSyncId(),
          uploadFile: {
            uploadUrl: uploadUrlOf(row),
            assetUrl: assetUrlOf(row),
            contentType: row.contentType,
            filename: row.filename,
            size: row.size,
            metaData: row.metaData,
            headers: [{ key: 'Content-Type', value: row.contentType }],
          },
        };
      }),
    userUpdate: (
      _: unknown,
      { id, input }: { id: string; input: UserUpdateInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'timezone', 'avatarUrl'], 'input');
        if (id !== ctx.user.id && id !== 'me')
          throw gqlError('FORBIDDEN', 'You can only update your own account');
        const set: Partial<typeof user.$inferInsert> = {};
        if (input.name !== undefined) {
          const name = String(input.name).trim();
          if (!name || name.length > 255)
            throw gqlError('INVALID_INPUT', 'input.name must be 1–255 characters');
          set.name = name;
        }
        if (input.timezone !== undefined) {
          if (!input.timezone || !isValidTimezone(input.timezone))
            throw gqlError('INVALID_INPUT', 'input.timezone is not a known time zone');
          await updatePreferences(ctx.user.id, { timezone: input.timezone });
        }
        const current = await userRow(ctx.user.id);
        let newAvatarUpload: string | null = null;
        if (input.avatarUrl !== undefined) {
          if (input.avatarUrl === null) {
            set.image = null;
          } else {
            const upload = await ownStoredUpload(String(input.avatarUrl), ctx.user.id);
            if (!upload)
              throw gqlError('INVALID_INPUT', 'input.avatarUrl must be one of your uploads');
            const { maxAvatarMb } = await getStorageSettings();
            if (!AVATAR_IMAGE_TYPES.test(upload.contentType))
              throw gqlError(
                'INVALID_INPUT',
                'An avatar must be a PNG, JPEG, GIF, WebP or AVIF image',
              );
            if (upload.size > maxAvatarMb * MB)
              throw gqlError('INVALID_INPUT', `An avatar must be at most ${maxAvatarMb} MB`);
            set.image = assetPathOf(upload);
            newAvatarUpload = upload.id;
          }
        }
        if (Object.keys(set).length) {
          await db
            .update(user)
            .set({ ...set, updatedAt: new Date() })
            .where(eq(user.id, ctx.user.id));
        }
        if (input.avatarUrl !== undefined) {
          // The previous upload-based avatar is no longer used; the sweep removes it.
          const previous = avatarUploadId(current.image);
          if (previous && previous !== newAvatarUpload) await setUploadUsed(previous, false);
          if (newAvatarUpload) await setUploadUsed(newAvatarUpload, true);
        }
        return {
          success: true,
          lastSyncId: lastSyncId(),
          user: toGraphQLUser(await userRow(ctx.user.id), ctx.user.id),
        };
      }),
  },
};
