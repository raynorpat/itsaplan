import { randomUUID } from 'node:crypto';
import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm';

// Installing an OAuth application with `actor=app` (Linear's app actor). A workspace
// admin or owner installs it at the consent step, choosing the teams it may use; the
// install creates one app user per application (`user.workspace_role` = 'app'), and
// tokens of the install act as that user. Linear's `client_credentials` grant gives
// an installed application an app-user token. Uninstalling revokes every token of the
// application and suspends the app user; its comments and history stay.
//
// Tokens of the install carry the internal scope APP_ACTOR_SCOPE, which the authorize
// step adds for `actor=app` and strips from any other request (oauth.ts), so a token
// is mapped to the app user when it is checked (resolveOAuthAccessToken).

export const APP_ACTOR_SCOPE = 'actor:app';
export const APP_ROLE = 'app';

// Linear's actor parameter: `app` (and the older `application`).
export const isAppActor = (actor: unknown) => actor === 'app' || actor === 'application';

export interface TeamSelection {
  // Every public team, including ones created later (Linear's default).
  publicTeams: boolean;
  // Teams added by id, public or private.
  teamIds: string[];
}

// The team selection a consent request carries (`app_public_teams`, `app_team_ids`),
// or an error message. Without a selection the app gets every public team.
export async function parseTeamSelection(body: unknown): Promise<TeamSelection | string> {
  const input = (body ?? {}) as { app_public_teams?: unknown; app_team_ids?: unknown };
  const publicTeams = input.app_public_teams ?? true;
  if (typeof publicTeams !== 'boolean') return 'app_public_teams must be a boolean';
  const raw = input.app_team_ids ?? [];
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string'))
    return 'app_team_ids must be a list of team ids';
  const teamIds = [...new Set(raw as string[])];
  if (teamIds.length > 0) {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!teamIds.every((id) => UUID.test(id))) return 'Unknown team in app_team_ids';
    const found = await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(inArray(schema.team.id, teamIds));
    if (found.length !== teamIds.length) return 'Unknown team in app_team_ids';
  }
  if (!publicTeams && teamIds.length === 0) return 'Choose at least one team for the application';
  return { publicTeams, teamIds };
}

export async function isWorkspaceAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ role: schema.user.workspaceRole, suspendedAt: schema.user.suspendedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return !!row && !row.suspendedAt && (row.role === 'owner' || row.role === 'admin');
}

export interface Installation {
  clientId: string;
  appUserId: string;
  scopes: string[];
}

// The application's installation when it is installed.
export async function activeInstallation(clientId: string): Promise<Installation | null> {
  const [row] = await db
    .select({
      clientId: schema.oauthInstallation.clientId,
      appUserId: schema.oauthInstallation.appUserId,
      scopes: schema.oauthInstallation.scopes,
    })
    .from(schema.oauthInstallation)
    .where(
      and(
        eq(schema.oauthInstallation.clientId, clientId),
        isNull(schema.oauthInstallation.uninstalledAt),
      ),
    );
  return row ?? null;
}

// Installs the application, or installs it again with a new team selection and
// scopes. The app user takes the application's name and icon.
export async function installApplication(input: {
  clientId: string;
  installedByUserId: string;
  scopes: string[];
  selection: TeamSelection;
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ name: schema.oauthClient.name, icon: schema.oauthClient.icon })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, input.clientId));
    if (!client) throw new Error(`OAuth client ${input.clientId} not found`);
    const name = client.name?.trim() || 'Application';

    const [existing] = await tx
      .select({
        id: schema.oauthInstallation.id,
        appUserId: schema.oauthInstallation.appUserId,
        uninstalledAt: schema.oauthInstallation.uninstalledAt,
      })
      .from(schema.oauthInstallation)
      .where(eq(schema.oauthInstallation.clientId, input.clientId))
      .for('update');

    let appUserId: string;
    if (existing) {
      appUserId = existing.appUserId;
      // Installing again after an uninstall starts with no app tokens. A token the
      // plugin wrote after the uninstall deleted the others (an exchange whose checks
      // passed just before it) is refused while uninstalled and must not come back
      // with the new install. The new install's own tokens are issued after this.
      if (existing.uninstalledAt) {
        const appTokens = (
          table: typeof schema.oauthAccessToken | typeof schema.oauthRefreshToken,
        ) =>
          and(
            eq(table.clientId, input.clientId),
            or(eq(table.userId, appUserId), isNull(table.userId)),
          );
        await tx.delete(schema.oauthAccessToken).where(appTokens(schema.oauthAccessToken));
        await tx.delete(schema.oauthRefreshToken).where(appTokens(schema.oauthRefreshToken));
      }
      await tx
        .update(schema.user)
        .set({ name, image: client.icon ?? null, suspendedAt: null })
        .where(eq(schema.user.id, appUserId));
      await tx
        .update(schema.oauthInstallation)
        .set({
          publicTeams: input.selection.publicTeams,
          scopes: input.scopes,
          installedByUserId: input.installedByUserId,
          updatedAt: new Date(),
          uninstalledAt: null,
        })
        .where(eq(schema.oauthInstallation.id, existing.id));
      await tx.delete(schema.teamMember).where(eq(schema.teamMember.userId, appUserId));
    } else {
      // The address is on the reserved .invalid domain, so no mail reaches it, and the
      // session hook refuses any sign-in as an app user.
      const [created] = await tx
        .insert(schema.user)
        .values({
          name,
          email: `app-${randomUUID()}@apps.invalid`,
          emailVerified: false,
          image: client.icon ?? null,
          workspaceRole: APP_ROLE,
        })
        .returning({ id: schema.user.id });
      appUserId = created!.id;
      await tx.insert(schema.oauthInstallation).values({
        clientId: input.clientId,
        appUserId,
        publicTeams: input.selection.publicTeams,
        scopes: input.scopes,
        installedByUserId: input.installedByUserId,
      });
    }
    if (input.selection.teamIds.length > 0)
      await tx
        .insert(schema.teamMember)
        .values(input.selection.teamIds.map((teamId) => ({ teamId, userId: appUserId })))
        .onConflictDoNothing();
    return appUserId;
  });
}

// Uninstalls the application: every token, refresh token, consent and pending
// authorization code of it is deleted, and its app user (if it was installed with
// `actor=app`) is suspended and leaves its teams; its open agent sessions end as
// `stale`. Returns false for an unknown client.
export async function uninstallApplication(clientId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: schema.oauthClient.id })
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, clientId));
    if (!client) return false;
    const [installation] = await tx
      .update(schema.oauthInstallation)
      .set({ uninstalledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.oauthInstallation.clientId, clientId),
          isNull(schema.oauthInstallation.uninstalledAt),
        ),
      )
      .returning({ appUserId: schema.oauthInstallation.appUserId });
    if (installation) {
      await tx
        .update(schema.user)
        .set({ suspendedAt: new Date() })
        .where(eq(schema.user.id, installation.appUserId));
      await tx
        .delete(schema.teamMember)
        .where(eq(schema.teamMember.userId, installation.appUserId));
      // Its open agent sessions end: no agent will answer them. They stay readable.
      await tx
        .update(schema.agentSession)
        .set({ status: 'stale', endedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentSession.appUserId, installation.appUserId),
            inArray(schema.agentSession.status, ['pending', 'active', 'awaitingInput', 'stopping']),
          ),
        );
    }
    // Deliveries already queued for its webhook are not sent: the app is gone.
    await tx
      .update(schema.webhookDelivery)
      .set({ status: 'failed', lastError: 'application uninstalled' })
      .where(
        and(
          eq(schema.webhookDelivery.status, 'pending'),
          inArray(
            schema.webhookDelivery.webhookId,
            tx
              .select({ id: schema.webhook.id })
              .from(schema.webhook)
              .where(eq(schema.webhook.oauthClientId, clientId)),
          ),
        ),
      );
    await tx.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.clientId, clientId));
    await tx
      .delete(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.clientId, clientId));
    await tx.delete(schema.oauthConsent).where(eq(schema.oauthConsent.clientId, clientId));
    // Authorization codes are verification rows whose JSON value carries the client
    // id in its query.
    const escaped = JSON.stringify(clientId).replace(/[\\%_]/g, (c) => `\\${c}`);
    await tx
      .delete(schema.verification)
      .where(like(schema.verification.value, `%"client_id":${escaped}%`));
    return true;
  });
}

// Whether the user is an application's app user.
export async function isAppUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: schema.user.workspaceRole })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.role === APP_ROLE;
}
