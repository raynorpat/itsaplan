import { customer, customerNeed, db, issue } from '@repo/db';
import { and, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { requesterCountSql } from '../feedback/store';
import { customerFilterSql } from './customer-filter';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';
import { issueFilterSql } from './issue-filter';

// CustomerNeedFilter as SQL over `customer_need`: id, createdAt, updatedAt, priority,
// issue (a NullableIssueFilter) and customer (a NullableCustomerFilter), and / or.
// Comments and projects are not used here, so filtering on them is INVALID_INPUT.
function needHandlers(viewerId: string): FieldHandlers {
  return {
    id: (v, p) => compareId(customerNeed.id, v, p),
    createdAt: (v, p) => compare(customerNeed.createdAt, v, p),
    updatedAt: (v, p) => compare(customerNeed.updatedAt, v, p),
    priority: (v, p) => compare(customerNeed.priority, v, p),
    issue: (v) => {
      const { null: isNullFilter, ...rest } = v as Record<string, unknown>;
      // Every feedback item is on an issue.
      if (isNullFilter === true) return sql`false`;
      const match = issueFilterSql(rest, viewerId);
      return match
        ? inArray(customerNeed.issueId, db.select({ id: issue.id }).from(issue).where(match))
        : sql`true`;
    },
    customer: (v, p) => {
      const { null: isNullFilter, ...rest } = v as Record<string, unknown>;
      if (isNullFilter === true) return sql`${customerNeed.customerId} IS NULL`;
      const match = customerFilterSql(rest, viewerId, p);
      const ids = db.select({ id: customer.id }).from(customer).where(match);
      return (
        and(
          isNullFilter === false ? sql`${customerNeed.customerId} IS NOT NULL` : undefined,
          Object.keys(rest).length ? inArray(customerNeed.customerId, ids) : undefined,
        ) ?? sql`true`
      );
    },
  };
}

export function needFilterSql(filter: unknown, viewerId: string, path = 'filter') {
  return filterSql(filter, needHandlers(viewerId), path);
}

// IssueFilter.needs (CustomerNeedCollectionFilter) over the issue table: `some` /
// `every` match the issue's active feedback, `length` compares its count, and the
// direct fields mean "some feedback matches".
export function needCollectionFilter(viewerId: string) {
  const handlers = needHandlers(viewerId);
  const issuesWith = (match: SQL | undefined) =>
    db
      .select({ id: customerNeed.issueId })
      .from(customerNeed)
      .where(and(isNull(customerNeed.archivedAt), match));
  const collection: FieldHandlers = {
    ...Object.fromEntries(
      Object.entries(handlers).map(([key, handler]) => [
        key,
        (v: unknown, p: string) => inArray(issue.id, issuesWith(handler(v, p))),
      ]),
    ),
    some: (v, p) => inArray(issue.id, issuesWith(filterSql(v, handlers, p))),
    every: (v, p) => {
      const match = filterSql(v, handlers, p);
      return match
        ? notInArray(issue.id, issuesWith(sql`NOT COALESCE((${match}), false)`))
        : sql`true`;
    },
    length: (v, p) =>
      compare(
        sql`(SELECT count(*) FROM ${customerNeed} WHERE ${eq(customerNeed.issueId, issue.id)} AND ${customerNeed.archivedAt} IS NULL)`,
        v,
        p,
      ),
  };
  return (value: unknown, path: string): SQL => filterSql(value, collection, path) ?? sql`true`;
}

// IssueFilter.customerCount / customerImportantCount: the number of people asking
// (feedback/store.ts requesterCountSql).
export const customerCountFilter = (value: unknown, path: string): SQL =>
  compare(requesterCountSql(), value, path);
export const customerImportantCountFilter = (value: unknown, path: string): SQL =>
  compare(requesterCountSql(true), value, path);
