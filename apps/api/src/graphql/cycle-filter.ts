import { cycle, db } from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';
import { gqlError } from './errors';

// CycleFilter as SQL over the cycle table. Supported: id, number, name, startsAt,
// endsAt, completedAt, createdAt, updatedAt, team (id), the state flags isActive,
// isFuture, isPast, isNext, isPrevious ({ eq: true | false }), and / or. Anything
// else is INVALID_INPUT.

// A { eq: boolean } comparator on a condition.
function flag(condition: SQL) {
  return (value: unknown, path: string): SQL => {
    const { eq, ...rest } = value as { eq?: boolean };
    if (Object.keys(rest).length || typeof eq !== 'boolean')
      throw gqlError('INVALID_INPUT', `Filter ${path} supports only eq`);
    return eq ? condition : sql`NOT (${condition})`;
  };
}

const isActive = sql`(${cycle.completedAt} IS NULL AND ${cycle.startsAt} <= now() AND ${cycle.endsAt} > now())`;
// The team's earliest upcoming cycle, and its most recently completed one.
const isNext = sql`${cycle.id} = (SELECT c2.id FROM cycle c2 WHERE c2.team_id = ${cycle.teamId} AND c2.archived_at IS NULL AND c2.starts_at > now() ORDER BY c2.starts_at LIMIT 1)`;
const isPrevious = sql`${cycle.id} = (SELECT c2.id FROM cycle c2 WHERE c2.team_id = ${cycle.teamId} AND c2.completed_at IS NOT NULL ORDER BY c2.completed_at DESC LIMIT 1)`;

export const cycleFilterHandlers: FieldHandlers = {
  id: (v, p) => compareId(cycle.id, v, p),
  number: (v, p) => compare(cycle.number, v, p),
  name: (v, p) => compare(cycle.name, v, p),
  startsAt: (v, p) => compare(cycle.startsAt, v, p),
  endsAt: (v, p) => compare(cycle.endsAt, v, p),
  completedAt: (v, p) => compare(cycle.completedAt, v, p),
  createdAt: (v, p) => compare(cycle.createdAt, v, p),
  updatedAt: (v, p) => compare(cycle.updatedAt, v, p),
  team: (v, p) => refFilter(cycle.teamId, v, p),
  isActive: flag(isActive),
  isFuture: flag(sql`${cycle.startsAt} > now()`),
  isPast: flag(sql`${cycle.endsAt} <= now()`),
  isNext: flag(isNext),
  isPrevious: flag(isPrevious),
};

export const cycleFilterSql = (filter: unknown): SQL | undefined =>
  filterSql(filter, cycleFilterHandlers);

// The ids of cycles matching a filter, for filters on a cycle reference.
export const cycleIdsMatching = (match: SQL) =>
  db.select({ id: cycle.id }).from(cycle).where(match);
