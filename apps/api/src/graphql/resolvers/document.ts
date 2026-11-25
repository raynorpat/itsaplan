import { db, document } from '@repo/db';
import { and, eq, getTableColumns, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  assertDocumentParentAccess,
  visibleDocumentsSql,
  type DocumentParent,
} from '../../documents/access';
import {
  archiveDocument,
  createDocument,
  documentParent,
  documentUrl,
  getDocument,
  mapDocument,
  unarchiveDocument,
  updateDocument,
  type DocumentPatch,
  type DocumentRow,
} from '../../documents/store';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { documentFilterSql } from '../document-filter';
import { documentSortKeys, tieBreaks } from '../list-sorts';
import { paginateSorted } from '../sort';
import { gqlError } from '../errors';
import { issueById, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findProject } from './project';

// Linear's Document and DocumentContent. A document's id is also its
// documentContentId; DocumentContent is built from the document row. Access
// follows the document's project or issue (documents/access.ts).

export const toDocument = (row: DocumentRow) => ({ ...row, documentContentId: row.id });

type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null; sort?: unknown };

// Without includeArchived: the document and its parent are not archived.
export const openOnly = and(
  isNull(document.archivedAt),
  or(
    isNull(document.projectId),
    sql`${document.projectId} IN (SELECT id FROM project WHERE archived_at IS NULL)`,
  ),
  or(
    isNull(document.issueId),
    sql`${document.issueId} IN (SELECT id FROM issue WHERE archived_at IS NULL)`,
  ),
)!;

async function listDocuments(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  const scope = and(
    await visibleDocumentsSql(ctx.user.id),
    where,
    args.includeArchived ? undefined : openOnly,
    documentFilterSql(args.filter),
  );
  const keys = documentSortKeys(args.sort);
  if (keys)
    return paginateSorted(
      args,
      keys,
      tieBreaks.document,
      sql`${document.id}`,
      scope,
      (w, order, limit, select) =>
        db
          .select({ ...getTableColumns(document), sortValues: select })
          .from(document)
          .where(w)
          .orderBy(...order)
          .limit(limit),
      (row) => toDocument(mapDocument(row)),
    );
  return paginate(
    args,
    { id: document.id, createdAt: document.createdAt, updatedAt: document.updatedAt },
    scope,
    (w, order, limit) =>
      db
        .select()
        .from(document)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toDocument(mapDocument(row)),
  );
}

const FIELDS = [
  'title',
  'content',
  'icon',
  'color',
  'sortOrder',
  'projectId',
  'issueId',
  'ownerId',
];
type Input = Record<string, unknown>;

// sortOrder is stored as a number; Linear's input allows null, which has no meaning here.
function checkSortOrder(input: Input): void {
  if (input.sortOrder === null) throw gqlError('INVALID_INPUT', 'input.sortOrder cannot be null');
}

function checkIds(input: Input, fields: string[]): void {
  for (const f of fields)
    if (input[f] != null && !UUID_RE.test(String(input[f])))
      throw gqlError('INVALID_INPUT', `input.${f} is not a valid id`);
}

// The parent an input names, or null when it names none; both is INVALID_INPUT.
function inputParent(input: Input): DocumentParent | null {
  if (input.projectId && input.issueId)
    throw gqlError('INVALID_INPUT', 'Set only one of input.projectId and input.issueId');
  if (input.projectId) return { projectId: String(input.projectId) };
  if (input.issueId) return { issueId: String(input.issueId) };
  return null;
}

const payload = (row: DocumentRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  document: toDocument(row),
});
const archivePayload = (row: DocumentRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  entity: toDocument(row),
});

export function toDocumentContent(row: DocumentRow) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    documentId: row.id,
  };
}

// A document the viewer can see, by id or slug, or ENTITY_NOT_FOUND.
export async function findDocument(id: string, ctx: GraphQLContext): Promise<DocumentRow> {
  return guard(async () => {
    const found = await getDocument(id);
    if (!found) throw gqlError('ENTITY_NOT_FOUND', `Document ${id} not found`);
    await assertDocumentParentAccess(documentParent(found), ctx.user);
    return found;
  });
}

// The document when the viewer can see it, otherwise null.
export const visibleDocumentOrNull = (id: string | null, ctx: GraphQLContext) =>
  id && UUID_RE.test(id) ? findDocument(id, ctx).catch(() => null) : null;

type GraphQLDocument = ReturnType<typeof toDocument>;

export const documentResolvers = {
  Query: {
    document: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toDocument(await findDocument(id, ctx)),
    documents: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listDocuments(undefined, args, ctx),
  },
  Document: {
    // A release document (resolvers/release.ts) carries its release page's URL.
    url: async (d: GraphQLDocument & { releaseUrl?: string }) => d.releaseUrl ?? documentUrl(d),
    creator: (d: GraphQLDocument, _: unknown, ctx: GraphQLContext) =>
      userById(d.creatorUserId, ctx.user.id),
    updatedBy: (d: GraphQLDocument, _: unknown, ctx: GraphQLContext) =>
      userById(d.updatedByUserId, ctx.user.id),
    owner: (d: GraphQLDocument, _: unknown, ctx: GraphQLContext) =>
      userById(d.ownerUserId, ctx.user.id),
    project: (d: GraphQLDocument, _: unknown, ctx: GraphQLContext) =>
      d.projectId ? findProject(d.projectId, ctx).catch(() => null) : null,
    // A visible issue document means a visible issue (team members).
    issue: (d: GraphQLDocument) => (d.issueId ? issueById(d.issueId) : null),
    initiative: () => null,
  },
  DocumentContent: {
    document: async (c: { documentId: string }, _: unknown, ctx: GraphQLContext) => {
      const found = await visibleDocumentOrNull(c.documentId, ctx);
      return found ? toDocument(found) : null;
    },
    project: async (c: { documentId: string }, _: unknown, ctx: GraphQLContext) => {
      const found = await visibleDocumentOrNull(c.documentId, ctx);
      return found?.projectId ? findProject(found.projectId, ctx).catch(() => null) : null;
    },
    issue: async (c: { documentId: string }, _: unknown, ctx: GraphQLContext) => {
      const found = await visibleDocumentOrNull(c.documentId, ctx);
      return found?.issueId ? issueById(found.issueId) : null;
    },
  },
  Project: {
    documents: (p: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listDocuments(eq(document.projectId, p.id), args, ctx),
  },
  Issue: {
    documents: (i: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listDocuments(eq(document.issueId, i.id), args, ctx),
  },
  Mutation: {
    documentCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, [...FIELDS, 'id'], 'input');
        checkIds(input, ['id', 'projectId', 'issueId', 'ownerId']);
        checkSortOrder(input);
        const parent = inputParent(input);
        if (!parent) throw gqlError('INVALID_INPUT', 'Set input.projectId or input.issueId');
        await assertDocumentParentAccess(parent, ctx.user);
        const created = await createDocument(
          {
            ...(input as unknown as DocumentPatch),
            title: String(input.title ?? ''),
            id: input.id as string | undefined,
          },
          ctx.user.id,
        );
        return payload(created);
      }),
    documentUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, [...FIELDS, 'hiddenAt'], 'input');
        checkIds(input, ['projectId', 'issueId', 'ownerId']);
        checkSortOrder(input);
        const found = await findDocument(id, ctx);
        await assertDocumentParentAccess(documentParent(found), ctx.user);
        const target = inputParent(input);
        if (target) await assertDocumentParentAccess(target, ctx.user);
        const { hiddenAt, ...rest } = input;
        let hidden: Date | null | undefined;
        if (hiddenAt !== undefined) {
          hidden = hiddenAt === null ? null : new Date(String(hiddenAt));
          if (hidden && Number.isNaN(hidden.getTime()))
            throw gqlError('INVALID_INPUT', 'input.hiddenAt must be a date');
        }
        const updated = await updateDocument(
          found.id,
          { ...(rest as DocumentPatch), ...(hidden !== undefined ? { hiddenAt: hidden } : {}) },
          ctx.user.id,
        );
        return payload(updated!);
      }),
    // Linear's documentDelete moves the document to the trash.
    documentDelete: (
      _: unknown,
      { id, ifParentDocumentId }: { id: string; ifParentDocumentId?: string | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        if (ifParentDocumentId != null)
          throw gqlError('INVALID_INPUT', 'Argument ifParentDocumentId is not supported');
        const found = await findDocument(id, ctx);
        await assertDocumentParentAccess(documentParent(found), ctx.user);
        return archivePayload(await archiveDocument(found.id, ctx.user.id));
      }),
    documentUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findDocument(id, ctx);
        await assertDocumentParentAccess(documentParent(found), ctx.user);
        return archivePayload(await unarchiveDocument(found.id, ctx.user.id));
      }),
  },
};
