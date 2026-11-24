import { randomUUID } from 'node:crypto';
import { trustedOrigins } from '@repo/auth';
import { attachment, db, issue } from '@repo/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { deleteObject } from '../shared/s3';
import { HttpError, iso, num } from '../shared/lib';
import { MB, mimeAllowed, type StorageSettings } from '../settings/storage';
import { emitEvent, isWatched, type WebhookAction } from '../webhooks/event';
import { attachmentData, issueData, type WebhookData } from '../webhooks/data';

// Attachments on issues (Linear's Attachment): links, and uploaded files whose bytes
// are in the S3-compatible object store (../shared/s3.ts). Every write goes through
// this module, which sends the Attachment webhooks.

export interface AttachmentRow {
  id: string;
  issueId: string;
  url: string;
  title: string;
  subtitle: string | null;
  iconUrl: string | null;
  metadata: Record<string, unknown>;
  sourceType: string | null;
  groupBySource: boolean;
  creatorUserId: string | null;
  // The person outside the workspace it is from (feedback's requester).
  externalUserCreatorId: string | null;
  // File columns: all set for an upload, all null for a link.
  publicId: string | null;
  s3Key: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export function mapAttachment(row: typeof attachment.$inferSelect): AttachmentRow {
  return {
    id: row.id,
    issueId: row.issueId,
    url: row.url,
    title: row.title,
    subtitle: row.subtitle,
    iconUrl: row.iconUrl,
    metadata: row.metadata,
    sourceType: row.sourceType,
    groupBySource: row.groupBySource,
    creatorUserId: row.creatorUserId,
    externalUserCreatorId: row.externalUserCreatorId,
    publicId: row.publicId,
    s3Key: row.s3Key,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes == null ? null : num(row.sizeBytes),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

const apiOrigin = () => (process.env.API_URL ?? '').replace(/\/+$/, '');

// Uploads store their download path relative to the API; a client is given (and may
// send back) the absolute URL. A URL on this API's download route (scheme and host in
// any case, any query) becomes that stored path, so it matches the row whatever
// API_URL is configured.
export function normalizeAttachmentUrl(url: string): string {
  const origin = apiOrigin();
  if (!origin) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.origin !== new URL(origin).origin) return url;
  const path = parsed.pathname.slice(new URL(origin).pathname.replace(/\/+$/, '').length);
  return /^\/attachments\/[^/]+\/raw$/.test(path) ? path : url;
}

// The URL a client sees: absolute on the API origin for an upload.
export function attachmentUrl(row: Pick<AttachmentRow, 'url'>): string {
  return row.url.startsWith('/') ? `${apiOrigin()}${row.url}` : row.url;
}

function validateLinkUrl(url: string, field = 'url'): void {
  if (url.startsWith('/attachments/'))
    throw new HttpError(400, 'url names an upload that is not on this issue');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, `${field} must be an absolute http or https URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new HttpError(400, `${field} must be an absolute http or https URL`);
}

function cleanTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new HttpError(400, 'title must not be empty');
  return trimmed;
}

async function issueTeamId(issueId: string): Promise<string | null> {
  const [row] = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));
  return row?.teamId ?? null;
}

async function sendAttachmentEvent(
  action: WebhookAction,
  row: AttachmentRow,
  actorUserId: string | null,
  before?: WebhookData | null,
): Promise<void> {
  const teamId = await issueTeamId(row.issueId);
  if (!teamId) return;
  await emitEvent({
    type: 'Attachment',
    action,
    teamIds: [teamId],
    actorUserId,
    data: attachmentData(row),
    before: before ?? undefined,
  });
}

export async function getAttachment(id: string): Promise<AttachmentRow | null> {
  const [row] = await db.select().from(attachment).where(eq(attachment.id, id));
  return row ? mapAttachment(row) : null;
}

// Records an uploaded file. url is its public download path; title the filename.
export async function createAttachment(input: {
  issueId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  creatorUserId?: string | null;
  // Defaults to the filename.
  title?: string;
}): Promise<AttachmentRow> {
  const publicId = randomUUID();
  const [row] = await db
    .insert(attachment)
    .values({
      issueId: input.issueId,
      url: `/attachments/${publicId}/raw`,
      title: input.title?.trim() || input.filename,
      sourceType: 'upload',
      creatorUserId: input.creatorUserId ?? null,
      publicId,
      s3Key: input.s3Key,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    })
    .returning();
  const created = mapAttachment(row!);
  await sendAttachmentEvent('create', created, input.creatorUserId ?? null);
  return created;
}

export interface LinkInput {
  issueId: string;
  url: string;
  title?: string;
  subtitle?: string | null;
  iconUrl?: string | null;
  metadata?: Record<string, unknown>;
  groupBySource?: boolean;
  id?: string;
}

type AttachmentPatch = {
  title?: string;
  subtitle?: string | null;
  iconUrl?: string | null;
  metadata?: Record<string, unknown>;
  groupBySource?: boolean;
};

function patchValues(patch: AttachmentPatch) {
  if (
    patch.metadata !== undefined &&
    (patch.metadata === null || typeof patch.metadata !== 'object' || Array.isArray(patch.metadata))
  )
    throw new HttpError(400, 'metadata must be an object');
  if (patch.iconUrl != null) validateLinkUrl(patch.iconUrl, 'iconUrl');
  return {
    ...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
    ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
    ...(patch.iconUrl !== undefined ? { iconUrl: patch.iconUrl } : {}),
    ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
    ...(patch.groupBySource !== undefined ? { groupBySource: patch.groupBySource } : {}),
  };
}

async function findByUrl(issueId: string, url: string): Promise<AttachmentRow | null> {
  const [row] = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.issueId, issueId), eq(attachment.url, url)));
  return row ? mapAttachment(row) : null;
}

// Linear's attachmentCreate: creates a link, or updates the issue's attachment with
// the same URL (an upload keeps its file columns and source type). A new attachment
// without a title takes the URL as its title.
export async function upsertLinkAttachment(
  input: LinkInput,
  actorUserId: string,
): Promise<{ row: AttachmentRow; created: boolean }> {
  const url = normalizeAttachmentUrl(input.url);
  const existing = await findByUrl(input.issueId, url);
  if (existing) return { row: await applyPatch(existing, input, actorUserId), created: false };
  validateLinkUrl(url);
  const values = patchValues(input);
  let inserted;
  try {
    [inserted] = await db
      .insert(attachment)
      .values({
        ...values,
        ...(input.id ? { id: input.id } : {}),
        issueId: input.issueId,
        url,
        title: values.title ?? url,
        creatorUserId: actorUserId,
      })
      .onConflictDoNothing()
      .returning();
  } catch (err) {
    if (
      (err as { cause?: { code?: string } }).cause?.code === '23503' ||
      (err as { code?: string }).code === '23503'
    )
      throw new HttpError(404, 'Issue not found');
    throw err;
  }
  if (!inserted) {
    // A concurrent create of the same URL won, or the given id is taken.
    const raced = await findByUrl(input.issueId, url);
    if (!raced) throw new HttpError(409, 'Attachment id already in use');
    return { row: await applyPatch(raced, input, actorUserId), created: false };
  }
  const created = mapAttachment(inserted);
  await sendAttachmentEvent('create', created, actorUserId);
  return { row: created, created: true };
}

async function applyPatch(
  current: AttachmentRow,
  patch: AttachmentPatch,
  actorUserId: string,
): Promise<AttachmentRow> {
  const values = patchValues(patch);
  const [row] = await db
    .update(attachment)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(attachment.id, current.id))
    .returning();
  if (!row) throw new HttpError(404, 'Attachment not found');
  const updated = mapAttachment(row);
  await sendAttachmentEvent('update', updated, actorUserId, attachmentData(current));
  return updated;
}

// Linear's attachmentUpdate: title, subtitle, icon and metadata (replaced). The URL
// and issue do not change.
export async function updateAttachment(
  id: string,
  patch: Pick<AttachmentPatch, 'title' | 'subtitle' | 'iconUrl' | 'metadata'>,
  actorUserId: string,
): Promise<AttachmentRow | null> {
  const current = await getAttachment(id);
  if (!current) return null;
  return applyPatch(current, patch, actorUserId);
}

// Deletes an attachment. For an upload it also strips the file's embeds from the
// issue and removes the object (best-effort: the row is already gone).
export async function deleteAttachment(
  id: string,
  actorUserId: string | null,
): Promise<AttachmentRow | null> {
  const [row] = await db.delete(attachment).where(eq(attachment.id, id)).returning();
  if (!row) return null;
  const deleted = mapAttachment(row);
  if (deleted.s3Key && deleted.publicId) {
    await removeAttachmentEmbeds(deleted.issueId, deleted.publicId);
    const key = deleted.s3Key;
    await deleteObject(key).catch((err) => {
      console.error(
        `[planner] failed to delete object ${key}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
  await sendAttachmentEvent('remove', deleted, actorUserId);
  return deleted;
}

// A feedback item's source attachment (sourceType `feedback`): the requester as its
// external creator, `url` a link to the item in the web app (the attachment's own id
// keeps it unique on the issue).
export interface FeedbackAttachmentInput {
  issueId: string;
  externalUserCreatorId: string;
  title: string;
  subtitle: string;
  creatorUserId: string | null;
  source: 'team' | 'portal' | 'form';
}

// The row values of a feedback source attachment, for a caller inserting it in its own
// transaction (it then sends the event with `announceAttachment` after the commit).
export function feedbackAttachmentValues(
  input: FeedbackAttachmentInput,
): typeof attachment.$inferInsert {
  const id = randomUUID();
  return {
    id,
    issueId: input.issueId,
    url: feedbackUrl(input.issueId, id),
    title: cleanTitle(input.title),
    subtitle: input.subtitle,
    sourceType: 'feedback',
    // Where the feedback came from; the portal finds a visitor's votes by it.
    metadata: { source: input.source },
    groupBySource: true,
    creatorUserId: input.creatorUserId,
    externalUserCreatorId: input.externalUserCreatorId,
  };
}

export const announceAttachment = sendAttachmentEvent;

export async function createFeedbackAttachment(
  input: FeedbackAttachmentInput,
): Promise<AttachmentRow> {
  const [row] = await db.insert(attachment).values(feedbackAttachmentValues(input)).returning();
  const created = mapAttachment(row!);
  await sendAttachmentEvent('create', created, input.creatorUserId);
  return created;
}

function feedbackUrl(issueId: string, attachmentId: string): string {
  return `${trustedOrigins[0]}/issue/${issueId}?feedback=${attachmentId}`;
}

type Executor = Pick<typeof db, 'update' | 'select'>;

// Moves an attachment to another issue (a feedback item moved with its source). A
// feedback attachment's link follows the issue. `exec` lets a caller run the write in
// its own transaction; it then sends the event with `announceAttachmentMove` after
// the commit.
export async function moveAttachmentRow(
  exec: Executor,
  id: string,
  issueId: string,
): Promise<{ before: AttachmentRow; moved: AttachmentRow } | null> {
  const [found] = await exec.select().from(attachment).where(eq(attachment.id, id));
  if (!found || found.issueId === issueId) return null;
  const before = mapAttachment(found);
  const [row] = await exec
    .update(attachment)
    .set({
      issueId,
      ...(before.sourceType === 'feedback' ? { url: feedbackUrl(issueId, id) } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(attachment.id, id))
    .returning();
  return row ? { before, moved: mapAttachment(row) } : null;
}

export async function announceAttachmentMove(
  change: { before: AttachmentRow; moved: AttachmentRow },
  actorUserId: string | null,
): Promise<void> {
  await sendAttachmentEvent('update', change.moved, actorUserId, attachmentData(change.before));
}

// Renames the feedback attachments of one requester (their title is the requester's
// name), optionally pointing them at another requester first, with an Attachment
// update event for each. `exec` is the caller's transaction; the events go out after
// it commits, through the returned function.
export async function retitleFeedbackAttachments(
  exec: Executor,
  fromRequesterId: string,
  change: { title: string; externalUserCreatorId?: string },
): Promise<(actorUserId: string | null) => Promise<void>> {
  const before = await exec
    .select()
    .from(attachment)
    .where(eq(attachment.externalUserCreatorId, fromRequesterId));
  const rows = await exec
    .update(attachment)
    .set({ ...change, title: cleanTitle(change.title), updatedAt: sql`now()` })
    .where(eq(attachment.externalUserCreatorId, fromRequesterId))
    .returning();
  const previous = new Map(before.map((r) => [r.id, mapAttachment(r)]));
  return async (actorUserId) => {
    for (const row of rows) {
      const mapped = mapAttachment(row);
      const was = previous.get(row.id);
      await sendAttachmentEvent('update', mapped, actorUserId, was ? attachmentData(was) : null);
    }
  };
}

// The issue's uploaded files (links are served over GraphQL only).
export async function listAttachments(issueId: string): Promise<AttachmentRow[]> {
  const rows = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.issueId, issueId), isNotNull(attachment.s3Key)))
    .orderBy(attachment.createdAt);
  return rows.map(mapAttachment);
}

// Bytes currently stored for a team, across every issue in it. Read before an
// upload to enforce the instance team quota.
export async function getTeamAttachmentBytes(teamId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${attachment.sizeBytes}), 0)` })
    .from(attachment)
    .innerJoin(issue, eq(issue.id, attachment.issueId))
    .where(eq(issue.teamId, teamId));
  return num(rows[0]?.total ?? 0);
}

export async function getAttachmentByPublicId(publicId: string): Promise<AttachmentRow | null> {
  const rows = await db.select().from(attachment).where(eq(attachment.publicId, publicId));
  return rows[0] ? mapAttachment(rows[0]) : null;
}

// An embed of a deleted attachment left in markdown would 404 once the object is
// gone (or, worse, keep showing from the year-long immutable cache on the raw
// route). Strip any construct whose URL carries this attachment's publicId: a
// markdown image/link, or an inline <img>/<video>. The publicId is a uuid, so a
// URL substring match is specific to this one attachment.
function stripEmbeds(text: string, publicId: string): string {
  const id = publicId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`!?\\[[^\\]]*\\]\\([^)]*${id}[^)]*\\)`, 'g'), '')
    .replace(new RegExp(`<img\\b[^>]*${id}[^>]*>`, 'g'), '')
    .replace(new RegExp(`<video\\b[^>]*${id}[^>]*>(?:\\s*</video>)?`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Remove embeds of one attachment from the issue description. Called on delete so a removed attachment leaves no broken
// image behind.
export async function removeAttachmentEmbeds(issueId: string, publicId: string): Promise<void> {
  let changed = false;
  const [owner] = await db
    .select({ teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.id, issueId));
  const watched = !!owner && (await isWatched('Issue', [owner.teamId]));
  const beforeData = watched ? await issueData(issueId) : null;

  const [row] = await db
    .select({ description: issue.description })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (row) {
    const next = stripEmbeds(row.description, publicId);
    if (next !== row.description) {
      await db.update(issue).set({ description: next }).where(eq(issue.id, issueId));
      changed = true;
    }
  }

  // Bump updated_at so clients that sync by it pick up the cleaned description.
  if (changed) {
    await db
      .update(issue)
      .set({ updatedAt: sql`now()` })
      .where(eq(issue.id, issueId));
    const data = beforeData ? await issueData(issueId) : null;
    if (data && beforeData)
      await emitEvent({
        type: 'Issue',
        action: 'update',
        teamIds: [data.teamId as string],
        actorUserId: null,
        data,
        before: beforeData,
      });
  }
}

// The upload limits (see ../settings/storage.ts) are read per
// request, so a change to the allowed types takes effect at once.
export async function assertUploadAllowed(
  limits: StorageSettings,
  teamId: string,
  size: number,
  contentType: string,
): Promise<void> {
  if (size > limits.maxAttachmentMb * MB) {
    throw new HttpError(413, `File exceeds the ${limits.maxAttachmentMb} MB limit`);
  }
  if (!mimeAllowed(contentType, limits.attachmentMimeTypes)) {
    throw new HttpError(400, `Files of type "${contentType}" are not accepted on this instance`);
  }
  if (limits.teamQuotaMb > 0) {
    const used = await getTeamAttachmentBytes(teamId);
    if (used + size > limits.teamQuotaMb * MB) {
      throw new HttpError(
        413,
        `The team has used its ${limits.teamQuotaMb} MB storage quota. Delete attachments to free space.`,
      );
    }
  }
}
