import { db, releaseAccessKey, releasePipeline, user as userTable } from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { assertWorkspaceRole, type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { shownName } from '../shared/user-name';
import { assertPipelineRead } from './access';
import { recordAudit } from '../audit/store';

// Release pipeline access keys (Linear's AccessKey): the credential a CI job uses for
// the *ByAccessKey operations of one pipeline. Workspace owners and admins create and
// revoke them; owners, admins and members who see the pipeline list them. A key is
// returned once, at creation, and stored only as its SHA-256.

export const ACCESS_KEY_PREFIX = 'itpr_';

type PipelineRow = typeof releasePipeline.$inferSelect;

export interface AccessKeyDto {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  creator: { id: string; name: string } | null;
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function pipelineIdOf(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, 'pipelineId must be a release pipeline id');
  return value;
}

export async function createAccessKey(
  user: AuthUser | undefined | null,
  pipelineId: unknown,
): Promise<{ accessKey: AccessKeyDto; key: string }> {
  await assertWorkspaceRole(user, 'admin');
  const pipeline = await assertPipelineRead(user, pipelineIdOf(pipelineId));
  if (pipeline.trashed) throw new HttpError(404, `Release pipeline ${pipeline.id} not found`);
  const key = `${ACCESS_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(releaseAccessKey)
      .values({ pipelineId: pipeline.id, keyHash: hashKey(key), creatorId: user!.id })
      .returning();
    await recordAudit(
      'releaseAccessKeyCreated',
      {
        entityType: 'releaseAccessKey',
        entityId: inserted!.id,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
      },
      { tx, actorId: user!.id },
    );
    return inserted;
  });
  const [creator] = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, user!.id));
  return {
    accessKey: {
      id: row!.id,
      createdAt: iso(row!.createdAt),
      lastUsedAt: null,
      creator: creator ? { id: user!.id, name: shownName(creator) } : null,
    },
    key,
  };
}

// The pipeline's keys that are not revoked, oldest first, without the keys themselves.
export async function listAccessKeys(
  user: AuthUser | undefined | null,
  pipelineId: unknown,
): Promise<AccessKeyDto[]> {
  await assertWorkspaceRole(user, 'member');
  const pipeline = await assertPipelineRead(user, pipelineIdOf(pipelineId));
  const rows = await db
    .select({
      id: releaseAccessKey.id,
      createdAt: releaseAccessKey.createdAt,
      lastUsedAt: releaseAccessKey.lastUsedAt,
      creatorId: userTable.id,
      creatorName: userTable.name,
      creatorEmail: userTable.email,
    })
    .from(releaseAccessKey)
    .leftJoin(userTable, eq(userTable.id, releaseAccessKey.creatorId))
    .where(and(eq(releaseAccessKey.pipelineId, pipeline.id), isNull(releaseAccessKey.revokedAt)))
    .orderBy(asc(releaseAccessKey.createdAt));
  return rows.map((r) => ({
    id: r.id,
    createdAt: iso(r.createdAt),
    lastUsedAt: r.lastUsedAt ? iso(r.lastUsedAt) : null,
    creator: r.creatorId
      ? { id: r.creatorId, name: shownName({ name: r.creatorName, email: r.creatorEmail ?? '' }) }
      : null,
  }));
}

export async function revokeAccessKey(
  user: AuthUser | undefined | null,
  id: unknown,
): Promise<void> {
  await assertWorkspaceRole(user, 'admin');
  const notFound = new HttpError(404, 'Access key not found');
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound;
  const [row] = await db
    .select({ pipelineId: releaseAccessKey.pipelineId })
    .from(releaseAccessKey)
    .where(and(eq(releaseAccessKey.id, id), isNull(releaseAccessKey.revokedAt)));
  if (!row) throw notFound;
  try {
    await assertPipelineRead(user, row.pipelineId);
  } catch {
    throw notFound;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(releaseAccessKey)
      .set({ revokedAt: new Date() })
      .where(eq(releaseAccessKey.id, id));
    await recordAudit(
      'releaseAccessKeyRevoked',
      { entityType: 'releaseAccessKey', entityId: id, pipelineId: row.pipelineId },
      { tx, actorId: user!.id },
    );
  });
}

export interface ResolvedAccessKey {
  id: string;
  pipelineId: string;
}

// The key a credential names when it is not revoked and its pipeline is neither
// archived nor trashed, else null.
export async function resolveAccessKey(credential: string): Promise<ResolvedAccessKey | null> {
  if (!credential.startsWith(ACCESS_KEY_PREFIX)) return null;
  const [row] = await db
    .select({ id: releaseAccessKey.id, pipelineId: releaseAccessKey.pipelineId })
    .from(releaseAccessKey)
    .innerJoin(releasePipeline, eq(releasePipeline.id, releaseAccessKey.pipelineId))
    .where(
      and(
        eq(releaseAccessKey.keyHash, hashKey(credential)),
        isNull(releaseAccessKey.revokedAt),
        isNull(releasePipeline.archivedAt),
        eq(releasePipeline.trashed, false),
      ),
    );
  return row ?? null;
}

// Records that the key was used (Linear's AccessKey.lastUsedAt).
export async function touchAccessKey(id: string): Promise<void> {
  await db
    .update(releaseAccessKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(releaseAccessKey.id, id));
}

// The key's pipeline, read again for each operation.
export async function accessKeyPipeline(key: ResolvedAccessKey): Promise<PipelineRow> {
  const [row] = await db
    .select()
    .from(releasePipeline)
    .where(eq(releasePipeline.id, key.pipelineId));
  if (!row || row.archivedAt || row.trashed)
    throw new HttpError(401, 'The access key is not valid');
  return row;
}
