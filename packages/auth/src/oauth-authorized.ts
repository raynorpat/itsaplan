import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { and, arrayContains, eq, like, not } from 'drizzle-orm';
import { clientMetadata } from './oauth';
import { APP_ACTOR_SCOPE } from './oauth-install';

// The applications a person has authorized to act as themselves (their consents), and
// revoking one. An `actor=app` install is the workspace's, not the installer's: its
// consent is not listed here and revoking leaves its tokens alone (uninstalling is
// the admins' action, oauth-install.ts).

const INTERNAL_SCOPES = new Set(['offline_access', APP_ACTOR_SCOPE]);

export interface AuthorizedApplication {
  clientId: string;
  name: string;
  iconUrl: string | null;
  developer: string | null;
  scopes: string[];
  authorizedAt: string;
}

export async function authorizedApplications(userId: string): Promise<AuthorizedApplication[]> {
  const rows = await db
    .select({
      clientId: schema.oauthConsent.clientId,
      scopes: schema.oauthConsent.scopes,
      createdAt: schema.oauthConsent.createdAt,
      updatedAt: schema.oauthConsent.updatedAt,
      name: schema.oauthClient.name,
      icon: schema.oauthClient.icon,
      metadata: schema.oauthClient.metadata,
      disabled: schema.oauthClient.disabled,
    })
    .from(schema.oauthConsent)
    .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
    .where(eq(schema.oauthConsent.userId, userId));
  return rows
    .filter((row) => !row.disabled && !row.scopes.includes(APP_ACTOR_SCOPE))
    .map((row) => {
      const developer = clientMetadata(row.metadata).developer;
      return {
        clientId: row.clientId,
        name: row.name?.trim() || 'Application',
        iconUrl: row.icon ?? null,
        developer: typeof developer === 'string' ? developer : null,
        scopes: row.scopes.filter((s) => !INTERNAL_SCOPES.has(s)),
        authorizedAt: (row.updatedAt ?? row.createdAt ?? new Date()).toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Revokes the person's authorization of an application: their consent, their tokens
// and refresh tokens for it, and their pending authorization codes. Tokens of an
// `actor=app` install are kept.
export async function revokeAuthorization(userId: string, clientId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.oauthConsent)
      .where(
        and(
          eq(schema.oauthConsent.clientId, clientId),
          eq(schema.oauthConsent.userId, userId),
          not(arrayContains(schema.oauthConsent.scopes, [APP_ACTOR_SCOPE])),
        ),
      );
    await tx
      .delete(schema.oauthAccessToken)
      .where(
        and(
          eq(schema.oauthAccessToken.clientId, clientId),
          eq(schema.oauthAccessToken.userId, userId),
          not(arrayContains(schema.oauthAccessToken.scopes, [APP_ACTOR_SCOPE])),
        ),
      );
    await tx
      .delete(schema.oauthRefreshToken)
      .where(
        and(
          eq(schema.oauthRefreshToken.clientId, clientId),
          eq(schema.oauthRefreshToken.userId, userId),
          not(arrayContains(schema.oauthRefreshToken.scopes, [APP_ACTOR_SCOPE])),
        ),
      );
    // Pending codes are verification rows whose JSON value carries the user and the
    // client id in its query.
    const escape = (value: string) => JSON.stringify(value).replace(/[\\%_]/g, (c) => `\\${c}`);
    await tx
      .delete(schema.verification)
      .where(
        and(
          like(schema.verification.value, `%"client_id":${escape(clientId)}%`),
          like(schema.verification.value, `%"userId":${escape(userId)}%`),
          not(like(schema.verification.value, `%${APP_ACTOR_SCOPE}%`)),
        ),
      );
  });
}
