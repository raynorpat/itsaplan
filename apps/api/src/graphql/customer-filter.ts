import { customer, customerNeed, customerStatus, customerTier, db } from '@repo/db';
import { and, eq, inArray, isNull, notInArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { visibleNeedsSql } from '../feedback/access';
import { needFilterSql } from './customer-need-filter';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// CustomerFilter as SQL over the customer table: id, name, domains and externalIds
// (StringArrayComparator: some, every, length), owner (id, null), revenue, size,
// status (CustomerStatusFilter), tier (CustomerTierFilter, null), needs (some, every,
// length over the customer's active requests the viewer can see), createdAt, updatedAt,
// and / or. slackChannelId and anything else is INVALID_INPUT.

// StringArrayComparator over a text[] column: `some` / `every` apply the
// StringItemComparator to the items, `length` compares the item count.
function stringArray(column: AnyColumn, value: unknown, path: string): SQL {
  const items = (match: SQL) => sql`(SELECT 1 FROM unnest(${column}) AS item(v) WHERE ${match})`;
  const item = sql`item.v`;
  return (
    filterSql(
      value,
      {
        some: (v, p) => sql`EXISTS ${items(compare(item, v, p))}`,
        every: (v, p) =>
          sql`(cardinality(${column}) > 0 AND NOT EXISTS ${items(sql`NOT COALESCE((${compare(item, v, p)}), false)`)})`,
        length: (v, p) => compare(sql`cardinality(${column})`, v, p),
      },
      path,
    ) ?? sql`true`
  );
}

// CustomerStatusFilter and CustomerTierFilter; only the tier filter has displayName.
function listHandlers(table: typeof customerStatus | typeof customerTier): FieldHandlers {
  return {
    id: (v, p) => compareId(table.id, v, p),
    name: (v, p) => compare(table.name, v, p),
    color: (v, p) => compare(table.color, v, p),
    description: (v, p) => compare(table.description, v, p),
    position: (v, p) => compare(table.position, v, p),
    createdAt: (v, p) => compare(table.createdAt, v, p),
    updatedAt: (v, p) => compare(table.updatedAt, v, p),
  };
}

const statusFilterHandlers = listHandlers(customerStatus);
const tierHandlers: FieldHandlers = {
  ...listHandlers(customerTier),
  displayName: (v, p) =>
    compare(sql`COALESCE(${customerTier.displayName}, ${customerTier.name})`, v, p),
};

function customerHandlers(viewerId: string): FieldHandlers {
  const needsOf = (match: SQL | undefined) =>
    db
      .select({ id: customerNeed.customerId })
      .from(customerNeed)
      .where(
        and(
          isNull(customerNeed.archivedAt),
          sql`${customerNeed.customerId} IS NOT NULL`,
          visibleNeedsSql(viewerId),
          match,
        ),
      );
  return {
    id: (v, p) => compareId(customer.id, v, p),
    name: (v, p) => compare(customer.name, v, p),
    domains: (v, p) => stringArray(customer.domains, v, p),
    externalIds: (v, p) => stringArray(customer.externalIds, v, p),
    owner: (v, p) => refFilter(customer.ownerId, v, p),
    revenue: (v, p) => compare(customer.revenue, v, p),
    size: (v, p) => compare(customer.size, v, p),
    createdAt: (v, p) => compare(customer.createdAt, v, p),
    updatedAt: (v, p) => compare(customer.updatedAt, v, p),
    status: (v, p) =>
      inArray(
        customer.statusId,
        db
          .select({ id: customerStatus.id })
          .from(customerStatus)
          .where(filterSql(v, statusFilterHandlers, p) ?? sql`true`),
      ),
    tier: (v, p) => {
      const { null: isNullFilter, ...rest } = v as Record<string, unknown>;
      const parts: SQL[] = [];
      if (isNullFilter === true) return isNull(customer.tierId);
      if (isNullFilter === false) parts.push(sql`${customer.tierId} IS NOT NULL`);
      const match = filterSql(rest, tierHandlers, p);
      if (match)
        parts.push(
          inArray(
            customer.tierId,
            db.select({ id: customerTier.id }).from(customerTier).where(match),
          ),
        );
      return and(...parts) ?? sql`true`;
    },
    needs: (v, p) =>
      filterSql(
        v,
        {
          some: (x, q) => inArray(customer.id, needsOf(needFilterSql(x, viewerId, q))),
          every: (x, q) => {
            const match = needFilterSql(x, viewerId, q);
            return match
              ? notInArray(customer.id, needsOf(sql`NOT COALESCE((${match}), false)`))
              : sql`true`;
          },
          length: (x, q) =>
            compare(
              sql`(SELECT count(*) FROM ${customerNeed} WHERE ${eq(customerNeed.customerId, customer.id)} AND ${customerNeed.archivedAt} IS NULL AND ${visibleNeedsSql(viewerId)})`,
              x,
              q,
            ),
        },
        p,
      ) ?? sql`true`,
  };
}

export function customerFilterSql(
  filter: unknown,
  viewerId: string,
  path = 'filter',
): SQL | undefined {
  return filterSql(filter, customerHandlers(viewerId), path);
}
