import { db, appSecret, user, workspaceInvite } from '@repo/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { encryptSecret, decryptSecret } from '@repo/crypto';
import {
  hasEmailProvider,
  type SmtpConfig,
  type ResendConfig,
  type EmailConfig,
} from '@repo/mailer';

// Instance-wide authentication configuration: the mail provider used for
// authentication and notification email (from environment variables), the Google
// OAuth credentials, the approved email domains and the rules for who may join the
// workspace. Read by the better-auth instance in ./index.ts and by the api.
//
// The Google credentials are encrypted in app_secret under 'auth.google', with a
// `redacted` mirror the settings UI can read without decrypting.

const GOOGLE_SECRET_KEY = 'auth.google';

// ── Encrypted config storage ──────────────────────────────────────────────────

// The mail provider and the Google credentials are stored the same way: one JSON
// blob per key in app_secret, encrypted as a whole, with a `redacted` mirror the
// settings UI reads without decrypting.

async function readSecret<T>(key: string): Promise<T | null> {
  const rows = await db
    .select({ ciphertext: appSecret.ciphertext, iv: appSecret.iv, authTag: appSecret.authTag })
    .from(appSecret)
    .where(eq(appSecret.key, key));
  const row = rows[0];
  return row ? (JSON.parse(decryptSecret(row)) as T) : null;
}

async function writeSecret(key: string, value: unknown, redacted: object): Promise<void> {
  const enc = encryptSecret(JSON.stringify(value));
  await db
    .insert(appSecret)
    .values({
      key,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      redacted,
    })
    .onConflictDoUpdate({
      target: appSecret.key,
      set: {
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        redacted,
        updatedAt: sql`now()`,
      },
    });
}

function mergeSecret(current: string, next: string | undefined): string {
  return next && next.length > 0 ? next : current;
}

// ── Mail provider ─────────────────────────────────────────────────────────────

// The mail provider, from environment variables: SMTP (`SMTP_HOST`, `SMTP_PORT`,
// `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`) or Resend (`RESEND_API_KEY`), and the
// From address (`EMAIL_FROM`). SMTP wins when both are set.
export interface InstanceEmailConfig extends EmailConfig {
  smtp: SmtpConfig;
  resend: ResendConfig;
  from: string;
}

// The provider as shown to admins: which one is in use, never a secret.
export interface InstanceEmailDto {
  provider: 'smtp' | 'resend' | null;
  from: string;
}

// SMTP_SECURE: `tls` = implicit TLS (port 465), `starttls` = upgrade after connecting,
// `none` = plain. Mapped onto the mailer's names (ssl / tls / none).
function smtpEncryption(value: string | undefined): SmtpConfig['encryption'] {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'tls':
      return 'ssl';
    case 'starttls':
      return 'tls';
    default:
      return 'none';
  }
}

function envEmailConfig(): InstanceEmailConfig {
  const env = process.env;
  const host = (env.SMTP_HOST ?? '').trim();
  const port = Number(env.SMTP_PORT);
  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  return {
    smtp: {
      enabled: host.length > 0,
      host,
      port: Number.isInteger(port) && port > 0 ? port : null,
      encryption: smtpEncryption(env.SMTP_SECURE),
      username: env.SMTP_USER ?? '',
      password: env.SMTP_PASSWORD ?? '',
      timeout: null,
    },
    resend: { enabled: host.length === 0 && apiKey.length > 0, apiKey },
    from: env.EMAIL_FROM ?? '',
  };
}

// The configured provider, or null when none is set.
export async function getEmailConfig(): Promise<InstanceEmailConfig | null> {
  const config = envEmailConfig();
  return hasEmailProvider(config) ? config : null;
}

export async function getEmailSettings(): Promise<InstanceEmailDto> {
  const config = envEmailConfig();
  const provider = config.smtp.enabled ? 'smtp' : config.resend.enabled ? 'resend' : null;
  return { provider, from: config.from };
}

// Whether outbound mail can be sent. Without a provider, magic links are written to
// the API log instead (./index.ts) and nothing else is emailed.
export async function hasConfiguredEmailProvider(): Promise<boolean> {
  return (await getEmailConfig()) !== null;
}

// The provider notification email is sent through, or null when none is configured.
export async function getNotificationEmailConfig(): Promise<InstanceEmailConfig | null> {
  return getEmailConfig();
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

// The stored, decrypted credentials. Read by the Google provider in ./index.ts on
// every social request, never returned over HTTP.
export interface InstanceGoogleConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

// The config as returned to the client: the secret replaced by a boolean telling
// whether a value is stored.
export interface InstanceGoogleDto {
  enabled: boolean;
  clientId: string;
  hasClientSecret: boolean;
}

// A partial write. The secret keeps its stored value when omitted or sent empty (a
// masked field the user did not edit).
export interface InstanceGooglePatch {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
}

function defaultGoogleConfig(): InstanceGoogleConfig {
  return { enabled: false, clientId: '', clientSecret: '' };
}

function toGoogleDto(config: InstanceGoogleConfig): InstanceGoogleDto {
  return {
    enabled: config.enabled,
    clientId: config.clientId,
    hasClientSecret: config.clientSecret.length > 0,
  };
}

export async function getGoogleConfig(): Promise<InstanceGoogleConfig> {
  const stored = await readSecret<InstanceGoogleConfig>(GOOGLE_SECRET_KEY);
  // Merge over the default so a config written before a field was added stays valid.
  return { ...defaultGoogleConfig(), ...(stored ?? {}) };
}

export async function getGoogleSettings(): Promise<InstanceGoogleDto> {
  return toGoogleDto(await getGoogleConfig());
}

// Whether Google sign-in can run right now. The provider is always mounted, so this
// is what both the god settings and the public sign-in screen ask before offering it.
export function isGoogleUsable(config: InstanceGoogleConfig): boolean {
  return config.enabled && config.clientId.length > 0 && config.clientSecret.length > 0;
}

export async function hasConfiguredGoogle(): Promise<boolean> {
  return isGoogleUsable(await getGoogleConfig());
}

export async function setGoogleSettings(patch: InstanceGooglePatch): Promise<InstanceGoogleDto> {
  const current = await getGoogleConfig();
  const next: InstanceGoogleConfig = {
    enabled: patch.enabled ?? current.enabled,
    clientId: patch.clientId ?? current.clientId,
    clientSecret: mergeSecret(current.clientSecret, patch.clientSecret),
  };
  const redacted = toGoogleDto(next);
  await writeSecret(GOOGLE_SECRET_KEY, next, redacted);
  return redacted;
}

// ── Joining the workspace ───────────────────────────────────────────────────────

// The approved email domains from `APPROVED_EMAIL_DOMAINS` (comma-separated; case and
// surrounding spaces ignored). Read per call, so a test or a reload sees changes.
export function approvedDomains(): string[] {
  return (process.env.APPROVED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export interface PendingInvite {
  id: string;
  role: string;
  teamIds: string[];
}

// The pending, unexpired workspace invite for an address, or null. An invite applies
// to the account created for its address: that account exists only once the address
// is proven (a used magic link or Google), so the address is the proof.
export async function pendingInviteFor(email: string): Promise<PendingInvite | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const [row] = await db
    .select({
      id: workspaceInvite.id,
      role: workspaceInvite.role,
      teamIds: workspaceInvite.teamIds,
    })
    .from(workspaceInvite)
    .where(and(eq(workspaceInvite.email, address), gt(workspaceInvite.expiresAt, sql`now()`)));
  return row ?? null;
}

// Whether an address without an account may join the workspace, and as what: the
// first user of a fresh instance as owner; a pending invite with its role and teams;
// an approved domain as member. Null means it may not.
export async function mayJoin(
  email: string,
): Promise<{ role: string; teamIds: string[]; inviteId?: string } | null> {
  if ((await db.$count(user)) === 0) return { role: 'owner', teamIds: [] };
  const invite = await pendingInviteFor(email);
  if (invite) return { role: invite.role, teamIds: invite.teamIds, inviteId: invite.id };
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (domain && approvedDomains().includes(domain)) return { role: 'member', teamIds: [] };
  return null;
}
