import { db, document, issue, project, team } from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, eq, isNotNull, max, sql } from 'drizzle-orm';
import { projectTeamIds } from '../projects/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { documentData, type WebhookData } from '../webhooks/data';
import { canSeeDocument, type DocumentParent } from './access';

// Documents (Linear's Document): titled Markdown pages in a project or on an
// issue. The store validates the fields, the single parent and the owner, refuses
// an archived parent, and sends the Document webhooks; callers check access to the
// parent (access.ts) first.

const SORT_STEP = 1000;

// updated_at is set with the database clock (sql`now()`), like created_at's
// default, so it never reads earlier than the creation time.

export interface DocumentRow {
  id: string;
  title: string;
  content: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  slugId: string;
  projectId: string | null;
  issueId: string | null;
  creatorUserId: string | null;
  updatedByUserId: string | null;
  ownerUserId: string | null;
  hiddenAt: string | null;
  archivedAt: string | null;
  trashed: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewDocumentInput {
  id?: string;
  title: string;
  content?: string | null;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
  projectId?: string | null;
  issueId?: string | null;
  ownerId?: string | null;
}

export type DocumentPatch = Partial<Omit<NewDocumentInput, 'id'>> & { hiddenAt?: Date | null };

const isoOrNull = (d: Date | null) => (d ? iso(d) : null);

export function mapDocument(row: typeof document.$inferSelect): DocumentRow {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sortOrder,
    slugId: row.slugId,
    projectId: row.projectId,
    issueId: row.issueId,
    creatorUserId: row.creatorUserId,
    updatedByUserId: row.updatedByUserId,
    ownerUserId: row.ownerUserId,
    hiddenAt: isoOrNull(row.hiddenAt),
    archivedAt: isoOrNull(row.archivedAt),
    trashed: row.trashed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export const documentParent = (row: Pick<DocumentRow, 'projectId' | 'issueId'>): DocumentParent =>
  row.projectId ? { projectId: row.projectId } : { issueId: row.issueId! };

// By id or by slugId.
export async function getDocument(idOrSlug: string): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(document)
    .where(UUID_RE.test(idOrSlug) ? eq(document.id, idOrSlug) : eq(document.slugId, idOrSlug));
  return row ? mapDocument(row) : null;
}

// The teams a document belongs to: its project's teams, or its issue's team.
export async function documentTeamIds(parent: DocumentParent): Promise<string[]> {
  if ('projectId' in parent) return projectTeamIds(parent.projectId);
  const [row] = await db
    .select({ teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.id, parent.issueId));
  return row ? [row.teamId] : [];
}

export async function isParentArchived(parent: DocumentParent): Promise<boolean> {
  const [row] =
    'projectId' in parent
      ? await db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.id, parent.projectId), isNotNull(project.archivedAt)))
      : await db
          .select({ id: issue.id })
          .from(issue)
          .where(and(eq(issue.id, parent.issueId), isNotNull(issue.archivedAt)));
  return !!row;
}

// The parent's web page with the document as a fragment; the web has no document
// page yet.
export async function documentUrl(row: DocumentRow): Promise<string> {
  const origin = trustedOrigins[0];
  if (row.projectId) return `${origin}/projects/${row.projectId}#document-${row.slugId}`;
  const [found] = await db
    .select({ key: team.key, seq: issue.sequenceNumber })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(eq(issue.id, row.issueId!));
  return found
    ? `${origin}/team/${found.key}/issue/${found.seq}#document-${row.slugId}`
    : `${origin}#document-${row.slugId}`;
}

// The parent named by an input: exactly one of projectId / issueId (400 otherwise).
function parentFrom(input: { projectId?: string | null; issueId?: string | null }): DocumentParent {
  if (input.projectId && input.issueId)
    throw new HttpError(400, 'A document belongs to a project or an issue, not both');
  if (input.projectId) return { projectId: input.projectId };
  if (input.issueId) return { issueId: input.issueId };
  throw new HttpError(400, 'A document needs a projectId or an issueId');
}

async function assertParentOpen(parent: DocumentParent): Promise<void> {
  if (await isParentArchived(parent))
    throw new HttpError(400, 'The parent is archived; restore the parent first');
}

function validateTitle(title: string | null | undefined): void {
  if (title !== undefined && (title ?? '').trim() === '')
    throw new HttpError(400, 'Title must not be empty');
}

async function assertOwnerCanSee(ownerId: string | null | undefined, parent: DocumentParent) {
  if (ownerId && !(await canSeeDocument(ownerId, parent)))
    throw new HttpError(400, 'The owner must be able to see the document');
}

async function sendDocumentEvent(
  action: WebhookAction,
  id: string,
  actorUserId: string | null,
  before?: WebhookData | null,
  extraTeamIds: string[] = [],
): Promise<void> {
  const data = await documentData(id);
  if (!data) return;
  const teams = await documentTeamIds(documentParent(data as unknown as DocumentRow));
  await emitEvent({
    type: 'Document',
    action,
    teamIds: [...new Set([...teams, ...extraTeamIds])],
    actorUserId,
    data,
    before: before ?? undefined,
  });
}

const parentColumn = (parent: DocumentParent) =>
  'projectId' in parent
    ? eq(document.projectId, parent.projectId)
    : eq(document.issueId, parent.issueId);

export async function createDocument(
  input: NewDocumentInput,
  actorUserId: string,
): Promise<DocumentRow> {
  validateTitle(input.title);
  const parent = parentFrom(input);
  await assertParentOpen(parent);
  await assertOwnerCanSee(input.ownerId, parent);
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const [last] = await db
      .select({ value: max(document.sortOrder) })
      .from(document)
      .where(parentColumn(parent));
    sortOrder = (last?.value ?? 0) + SORT_STEP;
  }
  const [row] = await db
    .insert(document)
    .values({
      ...(input.id ? { id: input.id } : {}),
      title: input.title.trim(),
      content: input.content ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sortOrder,
      projectId: 'projectId' in parent ? parent.projectId : null,
      issueId: 'issueId' in parent ? parent.issueId : null,
      creatorUserId: actorUserId,
      updatedByUserId: actorUserId,
      ownerUserId: input.ownerId ?? null,
    })
    .returning();
  await sendDocumentEvent('create', row!.id, actorUserId);
  return mapDocument(row!);
}

// Setting projectId or issueId moves the document (the other parent is cleared).
export async function updateDocument(
  id: string,
  patch: DocumentPatch,
  actorUserId: string,
): Promise<DocumentRow | null> {
  const current = await getDocument(id);
  if (!current) return null;
  validateTitle(patch.title);
  const moving = !!(patch.projectId || patch.issueId);
  const parent = moving ? parentFrom(patch) : documentParent(current);
  if (moving) await assertParentOpen(parent);
  if (moving || patch.ownerId !== undefined)
    await assertOwnerCanSee(
      patch.ownerId !== undefined ? patch.ownerId : current.ownerUserId,
      parent,
    );
  const before = await documentData(current.id);
  const oldTeams = moving ? await documentTeamIds(documentParent(current)) : [];
  const { ownerId, title, projectId: _p, issueId: _i, ...rest } = patch;
  const [row] = await db
    .update(document)
    .set({
      ...rest,
      ...(title !== undefined ? { title: title!.trim() } : {}),
      ...(ownerId !== undefined ? { ownerUserId: ownerId } : {}),
      ...(moving
        ? {
            projectId: 'projectId' in parent ? parent.projectId : null,
            issueId: 'issueId' in parent ? parent.issueId : null,
          }
        : {}),
      updatedByUserId: actorUserId,
      updatedAt: sql`now()`,
    })
    .where(eq(document.id, current.id))
    .returning();
  await sendDocumentEvent('update', current.id, actorUserId, before, oldTeams);
  return mapDocument(row!);
}

// Linear's documentDelete: the document goes to the trash (archived and trashed).
export async function archiveDocument(id: string, actorUserId: string): Promise<DocumentRow> {
  const [row] = await db
    .update(document)
    .set({
      archivedAt: sql`coalesce(${document.archivedAt}, now())`,
      trashed: true,
      updatedByUserId: actorUserId,
      updatedAt: sql`now()`,
    })
    .where(eq(document.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Document not found');
  await sendDocumentEvent('remove', id, actorUserId);
  return mapDocument(row);
}

export async function unarchiveDocument(id: string, actorUserId: string): Promise<DocumentRow> {
  const current = await getDocument(id);
  if (!current) throw new HttpError(404, 'Document not found');
  await assertParentOpen(documentParent(current));
  const before = await documentData(id);
  const [row] = await db
    .update(document)
    .set({ archivedAt: null, trashed: null, updatedByUserId: actorUserId, updatedAt: sql`now()` })
    .where(eq(document.id, id))
    .returning();
  await sendDocumentEvent('update', id, actorUserId, before);
  return mapDocument(row!);
}
