import { db, initiative, initiativeUpdate } from '@repo/db';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// InitiativeFilter as SQL over the initiative table. Supported: id, name, slugId,
// status, health, priority, owner / creator / leadTeam (id, null), targetDate,
// startedAt, completedAt, createdAt, updatedAt, and / or. Anything else is
// INVALID_INPUT.

// The health of the newest initiative update that is not archived.
const latestHealth = sql`(
  SELECT u.health FROM initiative_update u
  WHERE u.initiative_id = ${initiative.id} AND u.archived_at IS NULL
  ORDER BY u.created_at DESC, u.id DESC LIMIT 1
)`;

export const initiativeFilterHandlers: FieldHandlers = {
  id: (v, p) => compareId(initiative.id, v, p),
  name: (v, p) => compare(initiative.name, v, p),
  slugId: (v, p) => compare(initiative.slugId, v, p),
  status: (v, p) => compare(initiative.status, v, p),
  health: (v, p) => compare(latestHealth, v, p),
  priority: (v, p) => compare(initiative.priority, v, p),
  owner: (v, p) => refFilter(initiative.ownerUserId, v, p),
  creator: (v, p) => refFilter(initiative.creatorUserId, v, p),
  leadTeam: (v, p) => refFilter(initiative.leadTeamId, v, p),
  targetDate: (v, p) => compare(initiative.targetDate, v, p),
  startedAt: (v, p) => compare(initiative.startedAt, v, p),
  completedAt: (v, p) => compare(initiative.completedAt, v, p),
  createdAt: (v, p) => compare(initiative.createdAt, v, p),
  updatedAt: (v, p) => compare(initiative.updatedAt, v, p),
};

export function initiativeFilterSql(filter: unknown, path = 'filter'): SQL | undefined {
  return filterSql(filter, initiativeFilterHandlers, path);
}

// InitiativeUpdateFilter: id, initiative (InitiativeFilter), user (id), createdAt,
// updatedAt, and / or.
const initiativeUpdateHandlers: FieldHandlers = {
  id: (v, p) => compareId(initiativeUpdate.id, v, p),
  initiative: (v, p) =>
    inArray(
      initiativeUpdate.initiativeId,
      db
        .select({ id: initiative.id })
        .from(initiative)
        .where(initiativeFilterSql(v, p) ?? sql`true`),
    ),
  user: (v, p) =>
    filterSql(v, { id: (x, q) => compareId(initiativeUpdate.userId, x, q) }, p) ?? sql`true`,
  createdAt: (v, p) => compare(initiativeUpdate.createdAt, v, p),
  updatedAt: (v, p) => compare(initiativeUpdate.updatedAt, v, p),
};

export function initiativeUpdateFilterSql(filter: unknown): SQL | undefined {
  return filterSql(filter, initiativeUpdateHandlers);
}
