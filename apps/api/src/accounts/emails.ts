import { createHash, randomBytes } from 'node:crypto';
import { hasConfiguredEmailProvider, sendAuthEmail } from '@repo/auth';
import { db, user, userEmail } from '@repo/db';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { normalizeEmail } from '../invites/store';
import { recordAudit } from '../audit/store';
import { HttpError, iso, UUID_RE } from '../shared/lib';

// A user's extra email addresses (`user_email`), used only to match people during an
// issue import; sign-in uses the account's own address alone. Managed through the
// instance plugin (/api/auth/instance/account/emails*, instance/handlers.ts), since
// Linear's User has one `email`. An address counts once confirmed through the link
// mailed to it.

export const MAX_EXTRA_EMAILS = 10;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
// A pending address gets a new link at most this often.
const RESEND_AFTER_MS = 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ExtraEmailDto {
  id: string;
  email: string;
  verified: boolean;
  createdAt: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function listEmails(userId: string): Promise<ExtraEmailDto[]> {
  const rows = await db
    .select()
    .from(userEmail)
    .where(eq(userEmail.userId, userId))
    .orderBy(userEmail.createdAt);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    verified: r.verifiedAt != null,
    createdAt: iso(r.createdAt),
  }));
}

async function isTaken(email: string, userId: string): Promise<boolean> {
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email))
    .limit(1);
  if (account) return true;
  const [confirmed] = await db
    .select({ id: userEmail.id })
    .from(userEmail)
    .where(
      and(
        eq(userEmail.email, email),
        isNotNull(userEmail.verifiedAt),
        ne(userEmail.userId, userId),
      ),
    )
    .limit(1);
  return confirmed != null;
}

// Sends the confirmation link: the web's confirmation page, which shows the address
// and confirms only when its button is pressed (a mail scanner that opens the link
// confirms nothing). With no mail provider, or when sending fails, the link is written
// to the log, as the magic link is, so an operator can still pass it on.
async function sendConfirmation(email: string, token: string): Promise<void> {
  const url = `${(process.env.APP_URL ?? '').replace(/\/+$/, '')}/confirm-email?token=${token}`;
  const logLink = () => console.info(`[auth] email confirmation link for ${email}: ${url}`);
  if (!(await hasConfiguredEmailProvider())) {
    logLink();
    return;
  }
  const sent = await sendAuthEmail({
    to: email,
    subject: 'Confirm your email address',
    text: 'Use the link below to add this address to your account. It expires in 24 hours.',
    url,
  }).catch(() => false);
  if (!sent) logLink();
}

// Adds a pending address and mails its confirmation link. Adding an address the user
// already has pending sends a new link; one already confirmed is refused.
export async function addEmail(userId: string, rawEmail: unknown): Promise<ExtraEmailDto> {
  if (typeof rawEmail !== 'string') throw new HttpError(400, 'email is required');
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (await isTaken(email, userId))
    throw new HttpError(400, 'This address belongs to another account');

  const existing = await db.select().from(userEmail).where(eq(userEmail.userId, userId));
  const own = existing.find((r) => r.email === email);
  if (own?.verifiedAt) throw new HttpError(400, 'This address is already on your account');
  if (!own && existing.length >= MAX_EXTRA_EMAILS)
    throw new HttpError(400, `You can add at most ${MAX_EXTRA_EMAILS} addresses`);
  // The last link went out at its expiry minus the token's lifetime.
  const lastSent = own?.tokenExpiresAt ? own.tokenExpiresAt.getTime() - TOKEN_TTL_MS : null;
  if (lastSent !== null && Date.now() - lastSent < RESEND_AFTER_MS)
    throw new HttpError(429, 'Wait a minute before sending another link to this address');

  const token = randomBytes(32).toString('base64url');
  const fields = {
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
  const [row] = own
    ? await db.update(userEmail).set(fields).where(eq(userEmail.id, own.id)).returning()
    : await db
        .insert(userEmail)
        .values({ userId, email, ...fields })
        .onConflictDoUpdate({ target: [userEmail.userId, userEmail.email], set: fields })
        .returning();
  await sendConfirmation(email, token);
  await recordAudit(
    'emailAdded',
    { entityType: 'userEmail', entityId: row!.id, email },
    {
      actorId: userId,
    },
  );
  return { id: row!.id, email, verified: false, createdAt: iso(row!.createdAt) };
}

async function pendingByToken(token: unknown) {
  if (typeof token !== 'string' || !token) throw new HttpError(400, 'The link is not valid');
  const [row] = await db
    .select()
    .from(userEmail)
    .where(eq(userEmail.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || !row.tokenExpiresAt || row.tokenExpiresAt.getTime() < Date.now())
    throw new HttpError(400, 'The link is not valid or has expired');
  return row;
}

// The address a confirmation link is for, read by the confirmation page; changes
// nothing.
export async function confirmationAddress(token: unknown): Promise<{ email: string }> {
  return { email: (await pendingByToken(token)).email };
}

// Confirms the address whose link carries `token` (the confirmation page's button).
// Fails for an unknown, used or expired token, and for an address that meanwhile
// became another account's. Confirming removes other users' pending rows for the same
// address.
export async function confirmEmail(token: unknown): Promise<{ email: string }> {
  const row = await pendingByToken(token);
  if (await isTaken(row.email, row.userId))
    throw new HttpError(400, 'This address belongs to another account');
  await db.transaction(async (tx) => {
    await tx
      .update(userEmail)
      .set({ verifiedAt: new Date(), tokenHash: null, tokenExpiresAt: null })
      .where(eq(userEmail.id, row.id));
    await tx
      .delete(userEmail)
      .where(and(eq(userEmail.email, row.email), ne(userEmail.userId, row.userId)));
    await recordAudit(
      'emailConfirmed',
      { entityType: 'userEmail', entityId: row.id, email: row.email },
      { tx, actorId: row.userId },
    );
  });
  return { email: row.email };
}

export async function removeEmail(userId: string, id: unknown): Promise<void> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(400, 'id must be an id');
  const removed = await db
    .delete(userEmail)
    .where(and(eq(userEmail.id, id), eq(userEmail.userId, userId)))
    .returning({ id: userEmail.id, email: userEmail.email });
  if (removed.length === 0) throw new HttpError(404, 'Address not found');
  await recordAudit(
    'emailRemoved',
    { entityType: 'userEmail', entityId: removed[0]!.id, email: removed[0]!.email },
    { actorId: userId },
  );
}

// Each user's sign-in address and confirmed extra addresses, lowercased: the addresses
// an issue import matches a source person's email against.
export async function memberEmails(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const accounts = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, userIds));
  for (const a of accounts) map.set(a.id, [a.email.toLowerCase()]);
  const extras = await db
    .select({ userId: userEmail.userId, email: userEmail.email })
    .from(userEmail)
    .where(and(inArray(userEmail.userId, userIds), isNotNull(userEmail.verifiedAt)));
  for (const e of extras) map.get(e.userId)?.push(e.email);
  return map;
}
