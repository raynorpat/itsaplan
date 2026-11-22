import { assertDocumentParentAccess } from '../../documents/access';
import { documentParent, getDocument, type DocumentRow } from '../../documents/store';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { guard } from './mutations';

// Linear's Document and DocumentContent. A document's id is also its
// documentContentId; DocumentContent is built from the document row. Access
// follows the document's project or issue (documents/access.ts).

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
    await assertDocumentParentAccess(documentParent(found), ctx.user, 'read');
    return found;
  });
}

// The document when the viewer can see it, otherwise null.
export const visibleDocumentOrNull = (id: string | null, ctx: GraphQLContext) =>
  id && UUID_RE.test(id) ? findDocument(id, ctx).catch(() => null) : null;

export const documentResolvers = {
  DocumentContent: {
    document: (c: { documentId: string }, _: unknown, ctx: GraphQLContext) =>
      visibleDocumentOrNull(c.documentId, ctx),
  },
};
