import { APP_ROLE } from '@repo/auth';
import { db, oauthInstallation } from '@repo/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { SessionUser } from '../context';
import type { GraphQLContext } from '../context';

// The fields of better-auth's user row that Linear's User maps from.
export interface UserSource {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  workspaceRole?: string | null;
  suspendedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const isoOf = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

// A Linear User object for a user row, as seen by the viewer. Fields without a
// counterpart here resolve to their neutral value (see schema.ts).
export function toGraphQLUser(user: UserSource, viewerId: string) {
  return {
    id: user.id,
    name: user.name,
    displayName: user.name,
    email: user.email,
    avatarUrl: user.image ?? null,
    initials: initials(user.name),
    createdAt: isoOf(user.createdAt),
    updatedAt: isoOf(user.updatedAt),
    // Linear's role flags: admin covers owners and admins; active = not suspended.
    // An app user (an application installed with actor=app) is `app`; whether it is
    // assignable and mentionable comes from its install (User resolvers below).
    active: !user.suspendedAt,
    app: user.workspaceRole === APP_ROLE,
    owner: user.workspaceRole === 'owner',
    admin: user.workspaceRole === 'owner' || user.workspaceRole === 'admin',
    guest: user.workspaceRole === 'guest',
    isMe: user.id === viewerId,
  };
}

// The scopes an app user's install granted (none when uninstalled).
async function installScopes(appUserId: string): Promise<string[]> {
  const [row] = await db
    .select({ scopes: oauthInstallation.scopes })
    .from(oauthInstallation)
    .where(
      and(eq(oauthInstallation.appUserId, appUserId), isNull(oauthInstallation.uninstalledAt)),
    );
  return row?.scopes ?? [];
}

export const userResolvers = {
  Query: {
    viewer: (_: unknown, __: unknown, ctx: GraphQLContext) =>
      toGraphQLUser(ctx.user as SessionUser & UserSource, ctx.user.id),
  },
  User: {
    // People are always assignable and mentionable; an app user when its install
    // granted `app:assignable` / `app:mentionable` (Linear's app scopes).
    isAssignable: async (u: { id: string; app?: boolean }) =>
      !u.app || (await installScopes(u.id)).includes('app:assignable'),
    isMentionable: async (u: { id: string; app?: boolean }) =>
      !u.app || (await installScopes(u.id)).includes('app:mentionable'),
  },
};
