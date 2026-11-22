import { db, issue, issueLabel, label } from '@repo/db';
import { eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';

// IssueFilter.labels (IssueLabelCollectionFilter) as SQL over the issue table:
// `some` / `every` match the issue's labels, `length` compares their count, `null`
// matches issues with no labels (true) or with some (false), and the direct label
// fields mean "some label matches". Supported label fields: id, name, isGroup.

const handlers: FieldHandlers = {
  id: (v, p) => compareId(label.id, v, p),
  name: (v, p) => compare(label.name, v, p),
  isGroup: (v, p) => compare(label.isGroup, v, p),
};

const issuesWith = (match: SQL | undefined) =>
  db
    .select({ id: issueLabel.issueId })
    .from(issueLabel)
    .innerJoin(label, eq(label.id, issueLabel.labelId))
    .where(match ?? sql`true`);

const labelCount = sql`(SELECT count(*) FROM ${issueLabel} WHERE ${eq(issueLabel.issueId, issue.id)})`;

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
  length: (v, p) => compare(labelCount, v, p),
  null: (v) => (v ? sql`${labelCount} = 0` : sql`${labelCount} > 0`),
};

export function labelCollectionSql(value: unknown, path: string): SQL {
  return filterSql(value, collectionHandlers, path) ?? sql`true`;
}
