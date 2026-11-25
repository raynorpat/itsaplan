import { trustedOrigins } from '@repo/auth';
import {
  customer,
  customerNeed,
  customerStatus,
  customerTier,
  db,
  externalUser,
  portalBoard,
  user,
} from '@repo/db';
import { randomBytes } from 'node:crypto';
import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { assertWorkspaceRole, type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { emitEvent, isWatched, type WebhookAction } from '../webhooks/event';
import { cleanDomains, matchPeople } from './domains';
import { assertCustomersEnabled } from './settings';
import { defaultStatusId, readsCustomers, tierIdByName } from './statuses';

// Linear's Customer: a company the workspace hears from. Owners, admins and members
// read and write customers while Customers is on; guests and app users see none.
// Domains (lowercased) and external ids are unique across customers: every write that
// sets them takes one advisory lock and checks for an overlap first, so two writes
// cannot both pass. Deleting a customer clears it from its people, requests and
// portal boards (the foreign keys); merging moves them to the target. Every change
// sends a Customer webhook to all-teams webhooks (a customer belongs to no team).

export interface CustomerDto {
  id: string;
  slugId: string;
  name: string;
  domains: string[];
  externalIds: string[];
  mainSourceId: string | null;
  ownerId: string | null;
  statusId: string;
  tierId: string | null;
  revenue: number | null;
  size: number | null;
  logoUrl: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

type Row = typeof customer.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_NAME = 255;
const MAX_EXTERNAL_IDS = 50;

export const customerUrl = (slugId: string) => `${trustedOrigins[0]}/feedback/customers/${slugId}`;

export function mapCustomer(row: Row): CustomerDto {
  return {
    id: row.id,
    slugId: row.slugId,
    name: row.name,
    domains: row.domains,
    externalIds: row.externalIds,
    mainSourceId: row.mainSourceId,
    ownerId: row.ownerId,
    statusId: row.statusId,
    tierId: row.tierId,
    revenue: row.revenue,
    size: row.size,
    logoUrl: row.logoUrl,
    url: customerUrl(row.slugId),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// The slug: the name lowercased with other characters as "-", at most 40, then 6 hex.
function newSlugId(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'customer';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function assertWrite(actor: AuthUser): Promise<void> {
  await assertCustomersEnabled();
  await assertWorkspaceRole(actor, 'member');
}

// --- Input ------------------------------------------------------------------------

export interface CustomerInput {
  name?: unknown;
  domains?: unknown;
  externalIds?: unknown;
  mainSourceId?: unknown;
  ownerId?: unknown;
  statusId?: unknown;
  tierId?: unknown;
  revenue?: unknown;
  size?: unknown;
  logoUrl?: unknown;
}

type Patch = Partial<typeof customer.$inferInsert>;

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  const name = value.trim();
  if (name.length > MAX_NAME) throw new HttpError(400, `name is at most ${MAX_NAME} characters`);
  return name;
}

function cleanExternalIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new HttpError(400, 'externalIds must be a list of strings');
  const ids = [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
  if (ids.length > MAX_EXTERNAL_IDS)
    throw new HttpError(400, `A customer has at most ${MAX_EXTERNAL_IDS} external ids`);
  return ids;
}

function cleanCount(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new HttpError(400, `${field} must be a nonnegative integer`);
  return value;
}

async function cleanOwner(value: unknown): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, 'ownerId must name a user');
  const [row] = await db.select({ role: user.workspaceRole }).from(user).where(eq(user.id, value));
  if (!row) throw new HttpError(400, 'ownerId must name a user');
  if (row.role === 'app') throw new HttpError(400, 'Application accounts cannot own customers');
  return value;
}

async function cleanListRef(
  value: unknown,
  table: typeof customerStatus | typeof customerTier,
  field: string,
): Promise<string> {
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, `${field} must name a ${field === 'statusId' ? 'status' : 'tier'}`);
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, value));
  if (!row)
    throw new HttpError(400, `${field} must name a ${field === 'statusId' ? 'status' : 'tier'}`);
  return value;
}

// The patch for the fields present in `input` (undefined ones are left out).
async function patchOf(input: CustomerInput): Promise<Patch> {
  const patch: Patch = {};
  if (input.name !== undefined) patch.name = cleanName(input.name);
  if (input.domains !== undefined) patch.domains = cleanDomains(input.domains ?? []);
  if (input.externalIds !== undefined)
    patch.externalIds = cleanExternalIds(input.externalIds ?? []);
  if (input.mainSourceId !== undefined) {
    if (input.mainSourceId !== null && typeof input.mainSourceId !== 'string')
      throw new HttpError(400, 'mainSourceId must be a string');
    patch.mainSourceId = (input.mainSourceId as string | null) || null;
  }
  if (input.ownerId !== undefined) patch.ownerId = await cleanOwner(input.ownerId);
  if (input.statusId != null)
    patch.statusId = await cleanListRef(input.statusId, customerStatus, 'statusId');
  if (input.tierId !== undefined)
    patch.tierId =
      input.tierId === null ? null : await cleanListRef(input.tierId, customerTier, 'tierId');
  if (input.revenue !== undefined) patch.revenue = cleanCount(input.revenue, 'revenue');
  if (input.size !== undefined) patch.size = cleanCount(input.size, 'size');
  if (input.logoUrl !== undefined) {
    if (input.logoUrl !== null && typeof input.logoUrl !== 'string')
      throw new HttpError(400, 'logoUrl must be a string');
    patch.logoUrl = (input.logoUrl as string | null) || null;
  }
  return patch;
}

// Locks the customer keys and refuses domains or external ids another customer has.
async function assertKeysFree(
  tx: Tx,
  keys: { domains: string[]; externalIds: string[] },
  exceptIds: string[],
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customer-keys'))`);
  const others = exceptIds.length ? and(...exceptIds.map((id) => ne(customer.id, id))) : undefined;
  const textArray = (values: string[]) =>
    sql`ARRAY[${sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )}]::text[]`;
  const overlaps: SQL[] = [];
  if (keys.domains.length) overlaps.push(sql`${customer.domains} && ${textArray(keys.domains)}`);
  if (keys.externalIds.length)
    overlaps.push(sql`${customer.externalIds} && ${textArray(keys.externalIds)}`);
  if (!overlaps.length) return;
  const [clash] = await tx
    .select({ domains: customer.domains, externalIds: customer.externalIds })
    .from(customer)
    .where(and(others, or(...overlaps)))
    .limit(1);
  if (!clash) return;
  const domain = keys.domains.find((d) => clash.domains.includes(d));
  if (domain) throw new HttpError(409, `The domain ${domain} belongs to another customer`);
  const id = keys.externalIds.find((e) => clash.externalIds.includes(e));
  throw new HttpError(409, `The external id ${id} belongs to another customer`);
}

function assertMainSource(row: { mainSourceId: string | null; externalIds: string[] }): void {
  if (row.mainSourceId && !row.externalIds.includes(row.mainSourceId))
    throw new HttpError(400, 'mainSourceId must be one of externalIds');
}

// --- Events -----------------------------------------------------------------------

// Linear's Customer webhook data: the customer with its relation ids.
export function customerData(dto: CustomerDto): Record<string, unknown> {
  return { ...dto, archivedAt: null, slackChannelId: null };
}

async function sendEvent(
  action: WebhookAction,
  dto: CustomerDto,
  actorUserId: string | null,
  before?: CustomerDto,
): Promise<void> {
  if (!(await isWatched('Customer', []))) return;
  await emitEvent({
    type: 'Customer',
    action,
    teamIds: [],
    actorUserId,
    data: customerData(dto),
    ...(before ? { before: customerData(before) } : {}),
  });
}

// --- Reads ------------------------------------------------------------------------

async function rowById(idOrSlug: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(customer)
    .where(UUID_RE.test(idOrSlug) ? eq(customer.id, idOrSlug) : eq(customer.slugId, idOrSlug));
  return row ?? null;
}

// A customer by id or slugId, or 404 (also for a guest or while Customers is off).
export async function getCustomer(userId: string, idOrSlug: string): Promise<CustomerDto> {
  const row = (await readsCustomers(userId)) ? await rowById(idOrSlug) : null;
  if (!row) throw new HttpError(404, 'Customer not found');
  return mapCustomer(row);
}

// SQL over `customer` for the customers the user may read: all of them, or none.
export async function visibleCustomersSql(userId: string): Promise<SQL> {
  return (await readsCustomers(userId)) ? sql`true` : sql`false`;
}

// --- Writes -----------------------------------------------------------------------

export async function createCustomer(
  actor: AuthUser,
  input: CustomerInput & { id?: unknown },
): Promise<CustomerDto> {
  await assertWrite(actor);
  if (input.id != null && (typeof input.id !== 'string' || !UUID_RE.test(input.id)))
    throw new HttpError(400, 'id must be a UUID');
  const patch = await patchOf({ ...input, name: input.name ?? null });
  const values = {
    ...(input.id ? { id: input.id as string } : {}),
    ...patch,
    name: patch.name!,
    slugId: newSlugId(patch.name!),
    domains: patch.domains ?? [],
    externalIds: patch.externalIds ?? [],
    statusId: patch.statusId ?? (await defaultStatusId()),
  };
  assertMainSource({ mainSourceId: values.mainSourceId ?? null, externalIds: values.externalIds });
  const row = await db.transaction(async (tx) => {
    await assertKeysFree(tx, values, []);
    const [created] = await tx.insert(customer).values(values).returning();
    if (values.domains.length) await matchPeople(tx);
    return created!;
  });
  const dto = mapCustomer(row);
  await sendEvent('create', dto, actor.id);
  return dto;
}

export async function updateCustomer(
  actor: AuthUser,
  id: string,
  input: CustomerInput,
): Promise<CustomerDto> {
  await assertWrite(actor);
  const before = await rowById(id);
  if (!before) throw new HttpError(404, 'Customer not found');
  const patch = await patchOf(input);
  const next = { ...before, ...patch };
  assertMainSource(next);
  const row = await db.transaction(async (tx) => {
    if (patch.domains || patch.externalIds) await assertKeysFree(tx, next, [before.id]);
    const [updated] = await tx
      .update(customer)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customer.id, before.id))
      .returning();
    if (patch.domains) await matchPeople(tx);
    return updated;
  });
  if (!row) throw new HttpError(404, 'Customer not found');
  const dto = mapCustomer(row);
  await sendEvent('update', dto, actor.id, mapCustomer(before));
  return dto;
}

export async function deleteCustomer(actor: AuthUser, id: string): Promise<string> {
  await assertWrite(actor);
  const row = await rowById(id);
  if (!row) throw new HttpError(404, 'Customer not found');
  await db.transaction(async (tx) => {
    // The foreign key clears customer_id; how it was set goes with it.
    await tx
      .update(externalUser)
      .set({ customerId: null, customerSource: null })
      .where(eq(externalUser.customerId, row.id));
    await tx.delete(customer).where(eq(customer.id, row.id));
    await matchPeople(tx);
  });
  await sendEvent('remove', mapCustomer(row), actor.id);
  return row.id;
}

// Moves the source's requests, people, portal boards, domains and external ids to the
// target, then deletes the source.
export async function mergeCustomers(
  actor: AuthUser,
  sourceId: string,
  targetId: string,
): Promise<CustomerDto> {
  await assertWrite(actor);
  const [source, target] = [await rowById(sourceId), await rowById(targetId)];
  if (!source || !target) throw new HttpError(404, 'Customer not found');
  if (source.id === target.id) throw new HttpError(400, 'A customer cannot be merged into itself');
  const merged = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customer-keys'))`);
    const [s] = await tx.select().from(customer).where(eq(customer.id, source.id)).for('update');
    const [t] = await tx.select().from(customer).where(eq(customer.id, target.id)).for('update');
    if (!s || !t) throw new HttpError(404, 'Customer not found');
    await tx
      .update(customerNeed)
      .set({ customerId: t.id })
      .where(eq(customerNeed.customerId, s.id));
    await tx
      .update(externalUser)
      .set({ customerId: t.id })
      .where(eq(externalUser.customerId, s.id));
    await tx.update(portalBoard).set({ customerId: t.id }).where(eq(portalBoard.customerId, s.id));
    await tx.delete(customer).where(eq(customer.id, s.id));
    const [updated] = await tx
      .update(customer)
      .set({
        domains: [...new Set([...t.domains, ...s.domains])],
        externalIds: [...new Set([...t.externalIds, ...s.externalIds])],
        updatedAt: new Date(),
      })
      .where(eq(customer.id, t.id))
      .returning();
    await matchPeople(tx);
    return updated!;
  });
  const dto = mapCustomer(merged);
  await sendEvent('update', dto, actor.id, mapCustomer(target));
  await sendEvent('remove', mapCustomer(source), actor.id);
  return dto;
}

export interface UpsertInput extends CustomerInput {
  id?: unknown;
  externalId?: unknown;
  tierName?: unknown;
}

// Linear's customerUpsert: finds the customer by id, then by external id, then by any
// of the domains, and updates it; otherwise creates one (a name is then required). A
// tierName picks the tier by name, creating it when missing.
export async function upsertCustomer(actor: AuthUser, input: UpsertInput): Promise<CustomerDto> {
  await assertWrite(actor);
  const { id, externalId, tierName, ...fields } = input;
  if (externalId != null && (typeof externalId !== 'string' || !externalId.trim()))
    throw new HttpError(400, 'externalId must be a string');
  const domains = fields.domains != null ? cleanDomains(fields.domains) : [];
  let found: Row | null = null;
  if (typeof id === 'string' && UUID_RE.test(id)) found = await rowById(id);
  if (!found && typeof externalId === 'string') {
    const [row] = await db
      .select()
      .from(customer)
      .where(sql`${customer.externalIds} @> ARRAY[${externalId.trim()}]::text[]`);
    found = row ?? null;
  }
  if (!found && domains.length) {
    const [row] = await db
      .select()
      .from(customer)
      .where(
        sql`${customer.domains} && ARRAY[${sql.join(
          domains.map((d) => sql`${d}`),
          sql`, `,
        )}]::text[]`,
      );
    found = row ?? null;
  }
  const tierId = tierName != null ? await tierIdByName(String(tierName)) : fields.tierId;
  const withTier = { ...fields, ...(tierId !== undefined ? { tierId } : {}) };
  if (found) {
    const externalIds =
      typeof externalId === 'string' && !found.externalIds.includes(externalId.trim())
        ? [...found.externalIds, externalId.trim()]
        : undefined;
    return updateCustomer(actor, found.id, {
      ...withTier,
      ...(externalIds ? { externalIds } : {}),
    });
  }
  if (fields.name == null) throw new HttpError(400, 'name is required to create a customer');
  return createCustomer(actor, {
    ...withTier,
    ...(typeof id === 'string' ? { id } : {}),
    ...(typeof externalId === 'string' ? { externalIds: [externalId.trim()] } : {}),
  });
}

// The number of distinct issues with the customer's active requests.
export async function customerIssueCount(customerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(DISTINCT ${customerNeed.issueId})::int` })
    .from(customerNeed)
    .where(and(eq(customerNeed.customerId, customerId), sql`${customerNeed.archivedAt} IS NULL`));
  return row?.n ?? 0;
}

// The id of the customer with this external id, or null.
export async function customerByExternalId(externalId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(sql`${customer.externalIds} @> ARRAY[${externalId.trim()}]::text[]`);
  return row?.id ?? null;
}
