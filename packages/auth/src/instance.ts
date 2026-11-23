import { db, organization, user, workspaceInvite } from '@repo/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  hasEmailProvider,
  type SmtpConfig,
  type ResendConfig,
  type EmailConfig,
} from '@repo/mailer';

// Instance-wide authentication configuration: the mail provider used for
// authentication and notification email and the Google OAuth credentials (both from
// environment variables), the workspace's allowed sign-in services, the approved
// email domains and the rules for who may join the workspace. Read by the
// better-auth instance in ./index.ts and by the api.

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

// The Google OAuth credentials, from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
// Google sign-in is available only when both are set (and the workspace allows it,
// ./index.ts). Read per call, so a test or a reload sees changes.
export interface InstanceGoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function getGoogleConfig(): InstanceGoogleConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
  };
}

export function isGoogleUsable(config: InstanceGoogleConfig): boolean {
  return config.clientId.length > 0 && config.clientSecret.length > 0;
}

export async function hasConfiguredGoogle(): Promise<boolean> {
  return isGoogleUsable(getGoogleConfig());
}

// ── Allowed sign-in services ──────────────────────────────────────────────────

// The workspace's allowed sign-in services (organization.allowed_auth_services):
// `email` (magic link), `google`, `passkey`. Empty, or no organization row yet, means
// every configured service.
export async function allowedAuthServices(): Promise<string[]> {
  const [row] = await db
    .select({ services: organization.allowedAuthServices })
    .from(organization)
    .limit(1);
  return row?.services ?? [];
}

export async function isAuthServiceAllowed(
  service: 'email' | 'google' | 'passkey',
): Promise<boolean> {
  const allowed = await allowedAuthServices();
  return allowed.length === 0 || allowed.includes(service);
}

// What the sign-in screen needs before there is a session: which sign-in methods are
// offered. Public on purpose (the screen is reached logged out); it carries only the
// instance's own policy. The email field is always offered: an owner may always use a
// magic link, and without a mail provider the link is written to the API log.
export async function signInOptions(): Promise<{
  emailEnabled: boolean;
  google: boolean;
  passkey: boolean;
}> {
  return {
    emailEnabled: await hasConfiguredEmailProvider(),
    google: (await hasConfiguredGoogle()) && (await isAuthServiceAllowed('google')),
    passkey: await isAuthServiceAllowed('passkey'),
  };
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

// Startup warnings about the mail environment variables: a provider that is set but
// cannot send (Resend without a From address, SMTP with neither a From address nor
// a username to send as), and a production instance with no provider, whose magic
// links go to the API log.
export function emailConfigWarnings(env: Record<string, string | undefined>): string[] {
  const has = (key: string) => (env[key] ?? '').trim().length > 0;
  const warnings: string[] = [];
  if (has('SMTP_HOST')) {
    if (!has('EMAIL_FROM') && !has('SMTP_USER'))
      warnings.push(
        '[auth] SMTP_HOST is set without EMAIL_FROM or SMTP_USER: mail has no From address',
      );
  } else if (has('RESEND_API_KEY')) {
    if (!has('EMAIL_FROM'))
      warnings.push(
        '[auth] RESEND_API_KEY is set without EMAIL_FROM: Resend refuses every message',
      );
  } else if (env.NODE_ENV === 'production') {
    warnings.push(
      '[auth] no mail provider is configured: magic links are written to the API log, readable by anyone with log access',
    );
  }
  return warnings;
}
