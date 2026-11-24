import { attachment, db, issue } from '@repo/db';
import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { feedbackAttachmentsVisibleSql } from '../feedback/access';
import { normalizeAttachmentUrl } from '../attachments/store';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// AttachmentFilter as SQL over the attachment table: id, title, subtitle, url,
// createdAt, updatedAt, creator (id, null), sourceType, and / or. A url compared by
// eq / neq / in / nin is normalised first, so an upload matches its absolute URL.

function normalizeUrlComparator(value: unknown): unknown {
  const comp = { ...(value as Record<string, unknown>) };
  for (const op of ['eq', 'neq'])
    if (typeof comp[op] === 'string') comp[op] = normalizeAttachmentUrl(comp[op] as string);
  for (const op of ['in', 'nin'])
    if (Array.isArray(comp[op]))
      comp[op] = (comp[op] as unknown[]).map((u) =>
        typeof u === 'string' ? normalizeAttachmentUrl(u) : u,
      );
  return comp;
}

const handlers: FieldHandlers = {
  id: (v, p) => compareId(attachment.id, v, p),
  title: (v, p) => compare(attachment.title, v, p),
  subtitle: (v, p) => compare(attachment.subtitle, v, p),
  url: (v, p) => compare(attachment.url, normalizeUrlComparator(v), p),
  createdAt: (v, p) => compare(attachment.createdAt, v, p),
  updatedAt: (v, p) => compare(attachment.updatedAt, v, p),
  creator: (v, p) => refFilter(attachment.creatorUserId, v, p),
  sourceType: (v, p) => compare(attachment.sourceType, v, p),
};

export function attachmentFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, handlers);
}

// IssueFilter.attachments (AttachmentCollectionFilter) as SQL over the issue table:
// `some` / `every` match the issue's attachments, `length` compares their count, and
// the direct attachment fields mean "some attachment matches". Only attachments the
// viewer may see count, so a guest cannot probe feedback attachments.
export function attachmentCollectionFilter(viewerId: string) {
  const visible = feedbackAttachmentsVisibleSql(viewerId);
  const issuesWith = (match: SQL | undefined) =>
    db
      .select({ id: attachment.issueId })
      .from(attachment)
      .where(and(visible, match ?? sql`true`));

  const collectionHandlers: FieldHandlers = {
    ...Object.fromEntries(
      Object.entries(handlers).map(([key, handler]) => [
        key,
        (v: unknown, p: string) => inArray(issue.id, issuesWith(handler(v, p))),
      ]),
    ),
    some: (v, p) => inArray(issue.id, issuesWith(filterSql(v, handlers, p))),
    every: (v, p) => {
      const match = filterSql(v, handlers, p);
      // A NULL comparison is not a match, so it counts as a violation.
      return match
        ? notInArray(issue.id, issuesWith(sql`NOT COALESCE((${match}), false)`))
        : sql`true`;
    },
    length: (v, p) =>
      compare(
        sql`(SELECT count(*) FROM ${attachment} WHERE ${eq(attachment.issueId, issue.id)} AND ${visible})`,
        v,
        p,
      ),
  };

  return (value: unknown, path: string): SQL =>
    filterSql(value, collectionHandlers, path) ?? sql`true`;
}
