import {
  auth,
  clientMetadata,
  getActiveSession,
  isWorkspaceApplication,
  newClientSecret,
  uninstallApplication,
  type OAuthAppsHandlers,
} from '@repo/auth';
import { db, oauthAccessToken, oauthClient, oauthInstallation, teamMember, user } from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { HttpError } from '../shared/lib';
import { atLeast, workspaceRole } from '../shared/access';
import {
  WEBHOOK_RESOURCE_TYPES,
  deleteApplicationWebhook,
  getApplicationWebhook,
  rotateWebhookSecret,
  setApplicationWebhook,
  updateWebhook,
  type WebhookResourceType,
} from '../webhooks/store';
import { validateWebhookUrl } from '../webhooks/url';

// The workspace's OAuth applications (Linear's OAuth applications), managed by its
// admins and owners through the instance plugin (@repo/auth instance-plugin.ts):
//
// - create: name, description, developer, developer URL, icon URL, redirect URIs,
//   public client (no secret, PKCE required) or not, the client_credentials grant,
//   and a webhook (URL and resource types). Answers the client secret and the webhook
//   secret, which are never shown again.
// - update: the same fields except the client type; adding a webhook answers its
//   secret once. `webhookUrl: null` removes the webhook.
// - rotate the client secret (the old one stops at once; client_credentials tokens
//   are revoked, as Linear does), rotate the webhook secret.
// - archive: the application is uninstalled, its tokens and consents are deleted, it
//   can no longer be authorized and its webhook stops.
//
// An application is created through the OAuth plugin's server-only endpoint, which
// validates the client and stores its secret hashed; it is marked `application` in
// its metadata, which tells it from a client an MCP client registered itself. Every
// later change is written here, because the plugin lets only a client's creator
// change it and any admin manages every application.

export interface OAuthApplicationView {
  clientId: string;
  name: string;
  description: string | null;
  developer: string | null;
  developerUrl: string | null;
  iconUrl: string | null;
  redirectUris: string[];
  publicClient: boolean;
  clientCredentials: boolean;
  webhookUrl: string | null;
  webhookResourceTypes: WebhookResourceType[];
  archived: boolean;
  createdAt: string;
  installation: {
    appUserId: string;
    publicTeams: boolean;
    teamIds: string[];
    scopes: string[];
    installedAt: string;
  } | null;
}

async function requireAdmin(headers: Headers): Promise<{ id: string }> {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  if (!atLeast(await workspaceRole(session.user.id), 'admin'))
    throw new HttpError(403, 'Only a workspace admin or owner can manage applications');
  return session.user;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function httpUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a URL`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, `${field} must be a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new HttpError(400, `${field} must be an http or https URL`);
  if (url.hash) throw new HttpError(400, `${field} must not have a fragment`);
  return value;
}

const optionalUrl = (value: unknown, field: string): string | null =>
  value === null || value === '' ? null : httpUrl(value, field);

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${field} is too long`);
  return trimmed || null;
}

function requiredName(value: unknown): string {
  const name = optionalText(value, 'name', 100);
  if (!name) throw new HttpError(400, 'name is required');
  return name;
}

function redirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HttpError(400, 'redirectUris needs at least one URL');
  return [...new Set(value.map((uri) => httpUrl(uri, 'redirectUris')))];
}

function resourceTypes(value: unknown): WebhookResourceType[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HttpError(400, 'webhookResourceTypes needs at least one type');
  const unknown = value.find(
    (t) => !(WEBHOOK_RESOURCE_TYPES as readonly unknown[]).includes(t),
  ) as unknown;
  if (unknown !== undefined)
    throw new HttpError(400, `Resource type ${String(unknown)} is not supported`);
  return [...new Set(value as WebhookResourceType[])];
}

function clientIdOf(body: unknown): string {
  const clientId = isRecord(body) ? body.clientId : undefined;
  if (typeof clientId !== 'string' || !clientId) throw new HttpError(400, 'clientId is required');
  return clientId;
}

type ClientRow = typeof oauthClient.$inferSelect;

// A workspace application by client id; 404 for anything else (a self-registered
// client included).
async function application(clientId: string): Promise<ClientRow> {
  const [row] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId));
  if (!row || !isWorkspaceApplication(row.metadata))
    throw new HttpError(404, 'Application not found');
  return row;
}

async function activeApplication(clientId: string): Promise<ClientRow> {
  const row = await application(clientId);
  if (row.disabled) throw new HttpError(400, 'The application is archived');
  return row;
}

async function view(row: ClientRow): Promise<OAuthApplicationView> {
  const metadata = clientMetadata(row.metadata);
  const text = (key: string) =>
    typeof metadata[key] === 'string' ? (metadata[key] as string) : null;
  const webhook = await getApplicationWebhook(row.clientId);
  const [installed] = await db
    .select()
    .from(oauthInstallation)
    .where(
      and(eq(oauthInstallation.clientId, row.clientId), isNull(oauthInstallation.uninstalledAt)),
    );
  const teamIds = installed
    ? (
        await db
          .select({ teamId: teamMember.teamId })
          .from(teamMember)
          .where(eq(teamMember.userId, installed.appUserId))
      ).map((r) => r.teamId)
    : [];
  return {
    clientId: row.clientId,
    name: row.name ?? '',
    description: text('description'),
    developer: text('developer'),
    developerUrl: row.uri ?? null,
    iconUrl: row.icon ?? null,
    redirectUris: row.redirectUris,
    publicClient: !!row.public,
    clientCredentials: (row.grantTypes ?? []).includes('client_credentials'),
    webhookUrl: webhook?.url ?? null,
    webhookResourceTypes: webhook?.resourceTypes ?? [],
    archived: !!row.disabled,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
    installation: installed
      ? {
          appUserId: installed.appUserId,
          publicTeams: installed.publicTeams,
          teamIds,
          scopes: installed.scopes,
          installedAt: installed.updatedAt.toISOString(),
        }
      : null,
  };
}

// The webhook fields of a create or update body, or undefined when it has none.
function webhookInput(
  body: Record<string, unknown>,
  current: { url: string; resourceTypes: WebhookResourceType[] } | null,
): { url: string; resourceTypes: WebhookResourceType[] } | null | undefined {
  if (!('webhookUrl' in body) && !('webhookResourceTypes' in body)) return undefined;
  const url = 'webhookUrl' in body ? body.webhookUrl : current?.url;
  if (url === null || url === undefined || url === '') return null;
  if (typeof url !== 'string') throw new HttpError(400, 'webhookUrl must be a URL');
  const types =
    'webhookResourceTypes' in body
      ? resourceTypes(body.webhookResourceTypes)
      : current?.resourceTypes;
  return { url: validateWebhookUrl(url), resourceTypes: types ?? resourceTypes(undefined) };
}

const grantTypes = (clientCredentials: boolean) =>
  clientCredentials ? ['authorization_code', 'client_credentials'] : ['authorization_code'];

async function create(headers: Headers, body: unknown) {
  const admin = await requireAdmin(headers);
  if (!isRecord(body)) throw new HttpError(400, 'Invalid body');
  const publicClient = body.publicClient === true;
  const clientCredentials = body.clientCredentials === true;
  if (publicClient && clientCredentials)
    throw new HttpError(400, 'A public client cannot use client_credentials');
  const name = requiredName(body.name);
  const uris = redirectUris(body.redirectUris);
  const developerUrl = optionalUrl(body.developerUrl ?? null, 'developerUrl');
  const iconUrl = optionalUrl(body.iconUrl ?? null, 'iconUrl');
  const metadata = {
    application: true,
    description: optionalText(body.description, 'description', 500),
    developer: optionalText(body.developer, 'developer', 100),
  };
  const webhook = webhookInput(body, null);

  const created = (await auth.api.adminCreateOAuthClient({
    headers,
    body: {
      client_name: name,
      redirect_uris: uris,
      ...(developerUrl ? { client_uri: developerUrl } : {}),
      ...(iconUrl ? { logo_uri: iconUrl } : {}),
      token_endpoint_auth_method: publicClient ? 'none' : 'client_secret_post',
      type: publicClient ? 'native' : 'web',
      grant_types: grantTypes(clientCredentials) as ('authorization_code' | 'client_credentials')[],
      // Linear's applications may use PKCE but do not have to; a public client must.
      require_pkce: publicClient,
      metadata,
    },
  })) as { client_id: string; client_secret?: string };

  let webhookSecret: string | undefined;
  if (webhook) {
    const set = await setApplicationWebhook(created.client_id, {
      ...webhook,
      creatorUserId: admin.id,
    });
    webhookSecret = set.createdSecret ?? undefined;
  }
  return {
    application: await view(await application(created.client_id)),
    ...(created.client_secret ? { clientSecret: created.client_secret } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

async function update(headers: Headers, body: unknown) {
  const admin = await requireAdmin(headers);
  if (!isRecord(body)) throw new HttpError(400, 'Invalid body');
  const row = await activeApplication(clientIdOf(body));
  const metadata = clientMetadata(row.metadata);
  const set: Partial<typeof oauthClient.$inferInsert> = {};
  if ('name' in body) set.name = requiredName(body.name);
  if ('redirectUris' in body) set.redirectUris = redirectUris(body.redirectUris);
  if ('developerUrl' in body) set.uri = optionalUrl(body.developerUrl, 'developerUrl');
  if ('iconUrl' in body) set.icon = optionalUrl(body.iconUrl, 'iconUrl');
  if ('description' in body)
    metadata.description = optionalText(body.description, 'description', 500);
  if ('developer' in body) metadata.developer = optionalText(body.developer, 'developer', 100);
  if ('clientCredentials' in body) {
    if (body.clientCredentials === true && row.public)
      throw new HttpError(400, 'A public client cannot use client_credentials');
    set.grantTypes = grantTypes(body.clientCredentials === true);
  }
  const current = await getApplicationWebhook(row.clientId);
  const webhook = webhookInput(body, current);

  // The plugin keeps the metadata as a JSON string in the jsonb column.
  set.metadata = JSON.stringify(metadata);
  set.updatedAt = new Date();
  await db.update(oauthClient).set(set).where(eq(oauthClient.clientId, row.clientId));
  // The app user carries the application's name and icon.
  if (set.name !== undefined || set.icon !== undefined) {
    const [installed] = await db
      .select({ appUserId: oauthInstallation.appUserId })
      .from(oauthInstallation)
      .where(eq(oauthInstallation.clientId, row.clientId));
    if (installed)
      await db
        .update(user)
        .set({
          ...(set.name !== undefined ? { name: set.name! } : {}),
          ...(set.icon !== undefined ? { image: set.icon } : {}),
        })
        .where(eq(user.id, installed.appUserId));
  }

  let webhookSecret: string | undefined;
  if (webhook === null) await deleteApplicationWebhook(row.clientId);
  else if (webhook) {
    const result = await setApplicationWebhook(row.clientId, {
      ...webhook,
      creatorUserId: admin.id,
    });
    webhookSecret = result.createdSecret ?? undefined;
  }
  return {
    application: await view(await application(row.clientId)),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

async function rotateSecret(headers: Headers, body: unknown) {
  await requireAdmin(headers);
  const row = await activeApplication(clientIdOf(body));
  if (row.public || !row.clientSecret) throw new HttpError(400, 'A public client has no secret');
  const { secret, stored } = newClientSecret();
  await db.transaction(async (tx) => {
    await tx
      .update(oauthClient)
      .set({ clientSecret: stored, updatedAt: new Date() })
      .where(eq(oauthClient.clientId, row.clientId));
    // Tokens issued to the application itself (client_credentials) were issued on the
    // old secret alone; tokens people authorized stay.
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.clientId, row.clientId), isNull(oauthAccessToken.userId)));
  });
  return { clientSecret: secret };
}

async function rotateAppWebhookSecret(headers: Headers, body: unknown) {
  await requireAdmin(headers);
  const row = await activeApplication(clientIdOf(body));
  const webhook = await getApplicationWebhook(row.clientId);
  if (!webhook) throw new HttpError(404, 'The application has no webhook');
  const rotated = await rotateWebhookSecret(webhook.id);
  return { webhookSecret: rotated!.secret };
}

async function archive(headers: Headers, body: unknown) {
  await requireAdmin(headers);
  const row = await application(clientIdOf(body));
  await uninstallApplication(row.clientId);
  await db
    .update(oauthClient)
    .set({ disabled: true, updatedAt: new Date() })
    .where(eq(oauthClient.clientId, row.clientId));
  const webhook = await getApplicationWebhook(row.clientId);
  if (webhook) await updateWebhook(webhook.id, { enabled: false });
  return { success: true };
}

async function list(headers: Headers) {
  await requireAdmin(headers);
  const rows = await db.select().from(oauthClient).orderBy(asc(oauthClient.createdAt));
  const applications = await Promise.all(
    rows.filter((row) => isWorkspaceApplication(row.metadata)).map(view),
  );
  return { applications };
}

export const oauthAppsHandlers: OAuthAppsHandlers = {
  list,
  create,
  update,
  rotateSecret,
  rotateWebhookSecret: rotateAppWebhookSecret,
  archive,
};
