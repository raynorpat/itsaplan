import { createHash, randomBytes } from 'node:crypto';
import { hasConfiguredEmailProvider, sendAuthEmail, trustedOrigins } from '@repo/auth';
import { db, externalUser, portalSession, portalSignInToken } from '@repo/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { retitleFeedbackAttachments } from '../attachments/store';
import { requesterByEmail } from '../feedback/requesters';
import { activeRequester } from '../feedback/store';
import { HttpError, UUID_RE } from '../shared/lib';
import { optIn } from '../updates/preferences';
import { recordVisit } from '../updates/visits';
import { addressMayRead } from './access';
import { getBoardBySlug } from './boards';
import { allow, LIMITS } from './rate-limit';
import { matchPeople } from '../customers/domains';

// Portal visitors sign in with a link mailed from a board's sign-in form. The link
// opens the web's confirm page; its button posts the token (a mail scanner opening the
// link signs no one in). Confirming makes a portal session for the visitor's
// requester (project 1's ExternalUser, one per lowercased email), created on first
// sign-in with the name the visitor gives. The session is the `portal_session`
// cookie, read only by the /portal/* routes; better-auth sessions never count here.

export const SESSION_COOKIE = 'portal_session';
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 255;

export interface Visitor {
  requesterId: string;
  // The address that confirmed the sign-in link (restricted boards are checked
  // against it).
  email: string;
  displayName: string;
  avatarUrl: string | null;
  // The person's current customer (customer boards are checked against it).
  customerId: string | null;
}

export interface VisitorDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const visitorDto = (v: Visitor): VisitorDto => ({
  id: v.requesterId,
  displayName: v.displayName,
  avatarUrl: v.avatarUrl,
});

export function cleanName(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${what} required`);
  const name = value.trim();
  if (name.length > MAX_NAME) throw new HttpError(400, `${what} is at most ${MAX_NAME} characters`);
  return name;
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

// The Set-Cookie value for a session token (or for clearing it when null). Secure when
// the API is served over https.
export function sessionCookie(token: string | null): string {
  const secure = (process.env.API_URL ?? '').startsWith('https://') ? '; Secure' : '';
  const value = token ?? '';
  const age = token ? Math.floor(SESSION_TTL_MS / 1000) : 0;
  return `${SESSION_COOKIE}=${value}; Path=/portal; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

const toVisitor = (row: typeof externalUser.$inferSelect, email: string): Visitor => ({
  requesterId: row.id,
  email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  customerId: row.customerId,
});

// --- Links -----------------------------------------------------------------------

// Mails a portal link (a sign-in link, a form confirmation) after the caller's
// response; with no mail provider, or when sending fails, it is logged as
// `<logPrefix> <email>: <url>`.
export function mailPortalLink(input: {
  to: string;
  subject: string;
  text: string;
  url: string;
  logPrefix: string;
}): void {
  const logLink = () => console.info(`${input.logPrefix} ${input.to}: ${input.url}`);
  const send = async () => {
    if (!(await hasConfiguredEmailProvider())) {
      logLink();
      return;
    }
    const sent = await sendAuthEmail({
      to: input.to,
      subject: input.subject,
      text: input.text,
      url: input.url,
    }).catch(() => false);
    if (!sent) logLink();
  };
  void send().catch((err) =>
    console.error('[portal] mail failed:', err instanceof Error ? err.message : err),
  );
}

// The web app's origin, which the mailed links open.
export const webOrigin = () => (trustedOrigins[0] ?? '').replace(/\/+$/, '');

// Normalises an email address (trimmed, lowercased); 400 when it is not one.
export function cleanEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'email is required');
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320)
    throw new HttpError(400, 'Enter a valid email address');
  return email;
}

// Sends a sign-in link when the address may read the board and is not blocked. The
// answer never tells which happened, in its body or its timing: the mail is sent after
// the response, and an address over its limit gets the same answer and no link. `ip` is
// the client address when known (per-IP limits answer 429, which tells nothing about
// the address).
export async function requestSignInLink(
  rawEmail: unknown,
  slug: unknown,
  ip: string | null,
): Promise<void> {
  const email = cleanEmail(rawEmail);
  const { linksPerAddress, linksPerIp } = LIMITS;
  if (ip && !allow(`link-ip:${ip}`, linksPerIp.limit, linksPerIp.windowMs))
    throw new HttpError(429, 'Too many sign-in links. Try again later.');
  if (!allow(`link:${email}`, linksPerAddress.limit, linksPerAddress.windowMs)) return;

  const board = typeof slug === 'string' ? await getBoardBySlug(slug) : null;
  if (!board || !(await addressMayRead(board, email))) return;
  const known = await requesterByEmail(email);
  if (known?.portalBlockedAt) return;

  const token = randomBytes(32).toString('base64url');
  await db.insert(portalSignInToken).values({
    tokenHash: hashToken(token),
    email,
    boardId: board.id,
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
  mailPortalLink({
    to: email,
    subject: 'Your sign-in link',
    text: 'Use the link below to sign in to the board. It works once and expires in 15 minutes.',
    url: `${webOrigin()}/portal/${board.slug}/sign-in?token=${token}`,
    logPrefix: '[portal] sign-in link for',
  });
}

async function usableToken(token: unknown) {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'This link is not valid');
  const [row] = await db
    .select()
    .from(portalSignInToken)
    .where(
      and(
        eq(portalSignInToken.tokenHash, hashToken(token)),
        isNull(portalSignInToken.usedAt),
        gt(portalSignInToken.expiresAt, new Date()),
      ),
    );
  if (!row) throw new HttpError(400, 'This link is not valid or has expired');
  return row;
}

// What the confirm page needs before its button is pressed.
export async function signInLinkInfo(token: unknown): Promise<{ needsName: boolean }> {
  const row = await usableToken(token);
  return { needsName: !(await requesterByEmail(row.email)) };
}

// The address's requester, or a new one named `name` (a concurrent sign-in with the
// same address finds the one created first).
export async function requesterFor(email: string, name: string) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(externalUser)
        .values({ name, displayName: name, email })
        .returning();
      await matchPeople(tx, { personIds: [row!.id] });
      const [matched] = await tx.select().from(externalUser).where(eq(externalUser.id, row!.id));
      return matched!;
    });
  } catch (err) {
    const existing = await requesterByEmail(email);
    if (existing) return existing;
    throw err;
  }
}

// Uses the token (once) and starts a session. 400 `name required` when the address has
// no requester yet and no name was given; the token stays usable then.
export async function confirmSignIn(
  token: unknown,
  name: unknown,
): Promise<{ sessionToken: string; visitor: Visitor }> {
  const pending = await usableToken(token);
  let requester = await requesterByEmail(pending.email);
  const newName = requester ? null : cleanName(name, 'name');

  const [claimed] = await db
    .update(portalSignInToken)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(portalSignInToken.id, pending.id),
        isNull(portalSignInToken.usedAt),
        gt(portalSignInToken.expiresAt, new Date()),
      ),
    )
    .returning({ id: portalSignInToken.id });
  if (!claimed) throw new HttpError(400, 'This link is not valid or has expired');

  requester ??= await requesterFor(pending.email, newName!);
  if (requester.portalBlockedAt) throw new HttpError(400, 'This link is not valid or has expired');

  // The person came to the team themselves: email updates on (unless they unsubscribed).
  await optIn(requester.id);
  const sessionToken = await startSession(requester.id, pending.email);
  return { sessionToken, visitor: toVisitor(requester, pending.email) };
}

// A new portal session for `requesterId`, signed in with the confirmed `email`; returns
// the cookie value.
export async function startSession(requesterId: string, email: string): Promise<string> {
  const sessionToken = randomBytes(32).toString('base64url');
  await db.insert(portalSession).values({
    tokenHash: hashToken(sessionToken),
    externalUserId: requesterId,
    email,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionToken;
}

// --- Sessions --------------------------------------------------------------------

// The signed-in visitor, or null (no or expired session, or a blocked requester). A
// session of a requester merged into another acts as the one kept (merges and email
// changes end the sessions of the people involved; requesters.ts).
export async function visitorFromRequest(request: Request): Promise<Visitor | null> {
  const token = cookieValue(request);
  if (!token) return null;
  const [session] = await db
    .select({ externalUserId: portalSession.externalUserId, email: portalSession.email })
    .from(portalSession)
    .where(
      and(eq(portalSession.tokenHash, hashToken(token)), gt(portalSession.expiresAt, new Date())),
    );
  if (!session) return null;
  const requester = await activeRequester(session.externalUserId);
  if (!requester || requester.portalBlockedAt) return null;
  await recordVisit(requester);
  return toVisitor(requester, session.email);
}

export async function signOut(request: Request): Promise<void> {
  const token = cookieValue(request);
  if (token) await db.delete(portalSession).where(eq(portalSession.tokenHash, hashToken(token)));
}

// Changes the name the portal shows. The team's name for the person (`name`) stays.
export async function updateDisplayName(visitor: Visitor, value: unknown): Promise<Visitor> {
  const displayName = cleanName(value, 'displayName');
  const { updated, announce } = await db.transaction(async (tx) => {
    const [saved] = await tx
      .update(externalUser)
      .set({ displayName, updatedAt: sql`now()` })
      .where(eq(externalUser.id, visitor.requesterId))
      .returning();
    // Feedback source attachments show the requester's display name as their title.
    const sendEvents = await retitleFeedbackAttachments(tx, visitor.requesterId, {
      title: displayName,
    });
    return { updated: saved!, announce: sendEvents };
  });
  await announce(null);
  return toVisitor(updated, visitor.email);
}

// Blocks (ending the requester's sessions) or unblocks a requester. The caller checks
// the role.
export async function setPortalBlocked(requesterId: unknown, blocked: unknown): Promise<void> {
  if (typeof requesterId !== 'string' || !UUID_RE.test(requesterId))
    throw new HttpError(400, 'requesterId must be an id');
  if (typeof blocked !== 'boolean') throw new HttpError(400, 'blocked must be true or false');
  const requester = await activeRequester(requesterId);
  if (!requester) throw new HttpError(404, 'Requester not found');
  await db.transaction(async (tx) => {
    await tx
      .update(externalUser)
      .set({ portalBlockedAt: blocked ? new Date() : null, updatedAt: sql`now()` })
      .where(eq(externalUser.id, requester.id));
    if (blocked)
      await tx.delete(portalSession).where(eq(portalSession.externalUserId, requester.id));
  });
}
