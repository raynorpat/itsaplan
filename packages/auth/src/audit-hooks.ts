import { APIError, type createAuthMiddleware } from 'better-auth/api';
import {
  auditLoginFailed,
  auditRecord,
  reasonOf,
  RECORDED_REFUSALS,
  resultErrorCode,
} from './audit';

// The audit log's sign-in and account entries, from better-auth's hooks (index.ts):
// sign-ins and refused sign-ins, sign-out and session revokes, passkeys and personal API
// keys. Entries carry ids and names only, never a key, token or link.

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type SessionReader = (ctx: HookContext) => Promise<{ user: { id: string } } | null>;

// A refused sign-in whose address is known (the database hooks and the magic-link
// checks): recorded under the address, so the after hook skips its code.
export async function auditRefusal(address: string, code: string): Promise<void> {
  await auditLoginFailed(address, reasonOf(code));
}

// The sign-in method of an endpoint that signs people in, or null.
function signInMethod(ctx: HookContext): string | null {
  switch (ctx.path) {
    case '/magic-link/verify':
      return 'magicLink';
    case '/passkey/verify-authentication':
      return 'passkey';
    case '/sign-in/social':
      return 'google';
    case '/callback/:id':
      return (ctx.params as { id?: string } | undefined)?.id === 'google' ? 'google' : null;
    default:
      return null;
  }
}

async function actorOf(ctx: HookContext, readSession: SessionReader): Promise<string | null> {
  const session = await readSession(ctx).catch(() => null);
  return session?.user.id ?? null;
}

// The JSON an endpoint answered with, or null.
function returnedObject(ctx: HookContext): Record<string, unknown> | null {
  const returned = ctx.context.returned as unknown;
  if (!returned || returned instanceof APIError || returned instanceof Response) return null;
  return typeof returned === 'object' ? (returned as Record<string, unknown>) : null;
}

const bodyField = (ctx: HookContext, key: string): unknown =>
  ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>)[key] : undefined;

const REVOKES: Record<string, string> = {
  '/revoke-session': 'one',
  '/revoke-sessions': 'all',
  '/revoke-other-sessions': 'others',
};

// Runs in `hooks.before`: sign-out and the session revokes, recorded while the session
// that asks is still readable (the revoke may remove it).
export async function auditBeforeHook(ctx: HookContext, readSession: SessionReader): Promise<void> {
  if (ctx.path !== '/sign-out' && !(ctx.path in REVOKES)) return;
  const actorId = await actorOf(ctx, readSession);
  if (!actorId) return;
  if (ctx.path === '/sign-out') {
    await auditRecord('logout', { entityType: 'user', entityId: actorId }, actorId);
    return;
  }
  await auditRecord('sessionRevoked', { scope: REVOKES[ctx.path] }, actorId);
}

// Runs in `hooks.after`.
export async function auditAfterHook(ctx: HookContext, readSession: SessionReader): Promise<void> {
  const code = resultErrorCode(ctx.context.returned, ctx.context.responseHeaders);
  const method = signInMethod(ctx);
  if (method) {
    const session = ctx.context.newSession;
    if (session && !code) {
      const userId = session.user.id;
      await auditRecord('login', { method, entityType: 'user', entityId: userId }, userId);
    } else if (code && !RECORDED_REFUSALS.has(code)) {
      // A refusal with no address at hand: a bad link, passkey or Google answer.
      await auditLoginFailed('', reasonOf(code));
    }
    return;
  }
  if (code) return;
  switch (ctx.path) {
    case '/passkey/verify-registration': {
      const key = returnedObject(ctx);
      if (!key?.id) return;
      const actorId = (key.userId as string | undefined) ?? (await actorOf(ctx, readSession));
      await auditRecord(
        'passkeyAdded',
        { entityType: 'passkey', entityId: key.id, name: key.name ?? null },
        actorId,
      );
      return;
    }
    case '/passkey/delete-passkey': {
      const id = bodyField(ctx, 'id');
      if (typeof id !== 'string') return;
      await auditRecord(
        'passkeyRemoved',
        { entityType: 'passkey', entityId: id },
        await actorOf(ctx, readSession),
      );
      return;
    }
    case '/api-key/create': {
      const key = returnedObject(ctx);
      if (!key?.id) return;
      const actorId = (key.userId as string | undefined) ?? (await actorOf(ctx, readSession));
      await auditRecord(
        'apiKeyCreated',
        { entityType: 'apiKey', entityId: key.id, name: key.name ?? null },
        actorId,
      );
      return;
    }
    case '/api-key/delete': {
      const keyId = bodyField(ctx, 'keyId');
      if (typeof keyId !== 'string') return;
      await auditRecord(
        'apiKeyDeleted',
        { entityType: 'apiKey', entityId: keyId },
        await actorOf(ctx, readSession),
      );
      return;
    }
  }
}
