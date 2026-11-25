import { customer, customerStatus, customerTier, db } from '@repo/db';
import { asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  assertWorkspaceRole,
  NON_GUEST_ROLES,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { assertCustomersEnabled, customersEnabled } from './settings';

// Linear's CustomerStatus and CustomerTier: workspace lists ordered by position.
// Owners, admins and members read them while Customers is on; owners and admins change
// them. Deleting a status moves its customers to the default status (the first by
// position); deleting a tier clears it from its customers (the foreign key). The last
// status cannot be deleted.

export type ListKind = 'status' | 'tier';

export interface ListItemDto {
  id: string;
  name: string;
  displayName: string;
  color: string;
  description: string | null;
  position: number;
  archivedAt: null;
  createdAt: string;
  updatedAt: string;
}

const MAX_NAME = 255;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const tableOf = (kind: ListKind) => (kind === 'status' ? customerStatus : customerTier);
const label = (kind: ListKind) => (kind === 'status' ? 'Customer status' : 'Customer tier');

function toDto(row: typeof customerStatus.$inferSelect): ListItemDto {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName ?? row.name,
    color: row.color,
    description: row.description,
    position: row.position,
    archivedAt: null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// Whether the user reads customer data: Customers on and not a guest or app user.
export async function readsCustomers(userId: string): Promise<boolean> {
  return NON_GUEST_ROLES.includes(await workspaceRole(userId)) && (await customersEnabled());
}

async function assertManage(user: AuthUser): Promise<void> {
  await assertCustomersEnabled();
  await assertWorkspaceRole(user, 'admin');
}

export async function listItems(kind: ListKind, userId: string): Promise<ListItemDto[]> {
  if (!(await readsCustomers(userId))) return [];
  const table = tableOf(kind);
  const rows = await db.select().from(table).orderBy(asc(table.position), asc(table.createdAt));
  return rows.map(toDto);
}

export async function getItem(kind: ListKind, userId: string, id: string): Promise<ListItemDto> {
  const notFound = new HttpError(404, `${label(kind)} not found`);
  if (!UUID_RE.test(id) || !(await readsCustomers(userId))) throw notFound;
  const table = tableOf(kind);
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row) throw notFound;
  return toDto(row);
}

function cleanName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required`);
  const name = value.trim();
  if (name.length > MAX_NAME)
    throw new HttpError(400, `${field} is at most ${MAX_NAME} characters`);
  return name;
}

function cleanColor(value: unknown): string {
  if (typeof value !== 'string' || !COLOR_RE.test(value))
    throw new HttpError(400, 'color must be a hex colour such as #5e6ad2');
  return value;
}

function cleanPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new HttpError(400, 'position must be a number');
  return value;
}

const optionalText = (value: unknown, field: string): string | null => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  return value.trim() || null;
};

export interface ListItemInput {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  color?: unknown;
  description?: unknown;
  position?: unknown;
}

export async function createItem(
  kind: ListKind,
  user: AuthUser,
  input: ListItemInput,
): Promise<ListItemDto> {
  await assertManage(user);
  const table = tableOf(kind);
  const name = cleanName(input.name, 'name');
  const color = cleanColor(input.color);
  let position: number;
  if (input.position != null) position = cleanPosition(input.position);
  else {
    const [last] = await db.select({ max: sql<number | null>`max(${table.position})` }).from(table);
    position = (last?.max ?? -1000) + 1000;
  }
  if (input.id != null && (typeof input.id !== 'string' || !UUID_RE.test(input.id)))
    throw new HttpError(400, 'id must be a UUID');
  const [row] = await db
    .insert(table)
    .values({
      ...(input.id ? { id: input.id as string } : {}),
      name,
      displayName:
        input.displayName == null ? null : optionalText(input.displayName, 'displayName'),
      color,
      description:
        input.description == null ? null : optionalText(input.description, 'description'),
      position,
    })
    .returning();
  return toDto(row!);
}

export async function updateItem(
  kind: ListKind,
  user: AuthUser,
  id: string,
  input: ListItemInput,
): Promise<ListItemDto> {
  await assertManage(user);
  const table = tableOf(kind);
  const patch: Partial<typeof customerStatus.$inferInsert> = {};
  if (input.name != null) patch.name = cleanName(input.name, 'name');
  if (input.color != null) patch.color = cleanColor(input.color);
  if (input.position != null) patch.position = cleanPosition(input.position);
  if (input.displayName !== undefined)
    patch.displayName = optionalText(input.displayName, 'displayName');
  if (input.description !== undefined)
    patch.description = optionalText(input.description, 'description');
  if (!UUID_RE.test(id)) throw new HttpError(404, `${label(kind)} not found`);
  const [row] = await db
    .update(table)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(table.id, id))
    .returning();
  if (!row) throw new HttpError(404, `${label(kind)} not found`);
  return toDto(row);
}

export async function deleteItem(kind: ListKind, user: AuthUser, id: string): Promise<void> {
  await assertManage(user);
  const notFound = new HttpError(404, `${label(kind)} not found`);
  if (!UUID_RE.test(id)) throw notFound;
  if (kind === 'tier') {
    const [row] = await db.delete(customerTier).where(eq(customerTier.id, id)).returning();
    if (!row) throw notFound;
    return;
  }
  await db.transaction(async (tx) => {
    // Locks the list, so two deletes cannot remove the last two statuses together.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customer-status'))`);
    const [row] = await tx.select().from(customerStatus).where(eq(customerStatus.id, id));
    if (!row) throw notFound;
    const [next] = await tx
      .select({ id: customerStatus.id })
      .from(customerStatus)
      .where(ne(customerStatus.id, id))
      .orderBy(asc(customerStatus.position), asc(customerStatus.createdAt))
      .limit(1);
    if (!next) throw new HttpError(400, 'The last customer status cannot be deleted');
    await tx
      .update(customer)
      .set({ statusId: next.id, updatedAt: new Date() })
      .where(eq(customer.statusId, id));
    await tx.delete(customerStatus).where(eq(customerStatus.id, id));
  });
}

// A status or tier by id with no access check, for resolving a customer's fields.
// Statuses or tiers by id, in one query (the GraphQL loaders).
export async function itemsByIds(kind: ListKind, ids: readonly string[]): Promise<ListItemDto[]> {
  if (ids.length === 0) return [];
  const table = tableOf(kind);
  return (
    await db
      .select()
      .from(table)
      .where(inArray(table.id, [...ids]))
  ).map(toDto);
}

export async function itemById(kind: ListKind, id: string | null): Promise<ListItemDto | null> {
  if (!id) return null;
  const table = tableOf(kind);
  const [row] = await db.select().from(table).where(eq(table.id, id));
  return row ? toDto(row) : null;
}

// A tier by name (case-insensitive): customerUpsert's tierName. A missing tier is
// created with a grey colour only for owners and admins, who manage tiers.
export async function tierIdByName(name: string, actor: AuthUser): Promise<string> {
  const clean = cleanName(name, 'tierName');
  const [found] = await db
    .select({ id: customerTier.id })
    .from(customerTier)
    .where(sql`lower(${customerTier.name}) = lower(${clean})`)
    .limit(1);
  if (found) return found.id;
  const role = await workspaceRole(actor.id);
  if (role !== 'owner' && role !== 'admin')
    throw new HttpError(400, `There is no tier named ${clean}`);
  const [last] = await db
    .select({ max: sql<number | null>`max(${customerTier.position})` })
    .from(customerTier);
  const [row] = await db
    .insert(customerTier)
    .values({ name: clean, color: '#95a2b3', position: (last?.max ?? -1000) + 1000 })
    .returning({ id: customerTier.id });
  return row!.id;
}

// The status new customers get: the first by position.
export async function defaultStatusId(): Promise<string> {
  const [row] = await db
    .select({ id: customerStatus.id })
    .from(customerStatus)
    .orderBy(asc(customerStatus.position), asc(customerStatus.createdAt))
    .limit(1);
  if (!row) throw new HttpError(400, 'Create a customer status first');
  return row.id;
}
