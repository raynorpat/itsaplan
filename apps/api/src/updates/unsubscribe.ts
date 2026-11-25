import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { activeRequester } from '../feedback/store';
import { HttpError, UUID_RE } from '../shared/lib';
import {
  prefsOf,
  setPrefs,
  unsubscribe,
  type SummaryCadence,
  type UpdatePrefs,
} from './preferences';

// Unsubscribe links in requester emails: `<requesterId>.<HMAC>`, signed with the
// instance secret, so the link works without a session and cannot be made for
// someone else. The token does not expire: an old email's link keeps working, as
// RFC 8058 one-click unsubscribe expects.

// The signing key is derived from BETTER_AUTH_SECRET with HKDF (info "unsubscribe"), so
// it is separate from the key better-auth signs its cookies with.
function key(): Buffer {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error('BETTER_AUTH_SECRET is not set');
  return Buffer.from(hkdfSync('sha256', value, '', 'unsubscribe', 32));
}

const mac = (requesterId: string): Buffer =>
  createHmac('sha256', key()).update(`unsubscribe:${requesterId}`).digest();

export function unsubscribeToken(requesterId: string): string {
  return `${requesterId}.${mac(requesterId).toString('base64url')}`;
}

// The requester id the token was made for, or null for a malformed or forged token.
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const requesterId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = mac(requesterId);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return requesterId;
}

// The person the token was made for; a link of someone merged into another person
// acts on the person kept, who now gets that address's emails.
async function requesterOf(token: unknown) {
  const tokenId = verifyUnsubscribeToken(token);
  const row = tokenId && UUID_RE.test(tokenId) ? await activeRequester(tokenId) : null;
  if (!row) throw new HttpError(400, 'This link is not valid');
  return row;
}

// "jordan@acme.com" → "j***@acme.com": enough for the person to recognise the address
// without showing it to whoever holds the link.
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// What the unsubscribe page shows before its button is pressed.
export async function unsubscribeInfo(
  token: unknown,
): Promise<{ email: string | null; prefs: UpdatePrefs }> {
  const row = await requesterOf(token);
  return { email: maskEmail(row.email), prefs: prefsOf(row) };
}

// The page's buttons: without `summary`, every update off; with it, only the summary
// cadence changes and updates stay as they are.
export async function unsubscribeFromPage(token: unknown, summary: unknown): Promise<UpdatePrefs> {
  const row = await requesterOf(token);
  if (summary === undefined) {
    await unsubscribe(row.id);
    return { ...prefsOf(row), enabled: false, unsubscribed: true };
  }
  if (!['weekly', 'daily', 'off'].includes(summary as string))
    throw new HttpError(400, 'summary must be weekly, daily or off');
  return setPrefs(row.id, { summary: summary as SummaryCadence }, 'person');
}

// RFC 8058 one-click: the mail provider POSTs on the person's behalf.
export async function unsubscribeOneClick(token: unknown): Promise<void> {
  const row = await requesterOf(token);
  await unsubscribe(row.id);
}
