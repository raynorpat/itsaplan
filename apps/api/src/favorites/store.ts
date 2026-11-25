import { db, favorite } from '@repo/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import type { AuthUser } from '../shared/access';
import { visibleFavoritesSql } from './access';

// Favorites (Linear's Favorite): a person's own sidebar bookmarks and folders. Only the
// owner reads or changes a favorite; another person's favorite does not exist for
// them. A favorite points at exactly one target (an item, a fixed view, or a folder
// name); one per person and target, so creating it again returns the existing one and
// moves it to the folder and position given, as Linear does. Folders are not nested.
// Deleting a folder deletes the favorites in it (Linear); deleting a target deletes
// its favorites (foreign keys).

type Row = typeof favorite.$inferSelect;

export type FavoriteType =
  | 'issue'
  | 'project'
  | 'customView'
  | 'cycle'
  | 'document'
  | 'label'
  | 'projectLabel'
  | 'customer'
  | 'dashboard'
  | 'team'
  | 'user'
  | 'predefinedView'
  | 'folder';

export interface FavoriteDto {
  id: string;
  ownerId: string;
  type: FavoriteType;
  parentId: string | null;
  folderName: string | null;
  sortOrder: number;
  predefinedViewType: string | null;
  // The id of the item the favorite points at (null for a folder and a fixed view).
  targetId: string | null;
  // The team of a team's fixed view, or of a team favorite.
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
}

// The input key, the row column and the favorite type of each kind of target.
const TARGETS = [
  ['issueId', 'issueId', 'issue'],
  ['projectId', 'projectId', 'project'],
  ['customViewId', 'customViewId', 'customView'],
  ['cycleId', 'cycleId', 'cycle'],
  ['documentId', 'documentId', 'document'],
  ['labelId', 'labelId', 'label'],
  ['projectLabelId', 'projectLabelId', 'projectLabel'],
  ['customerId', 'customerId', 'customer'],
  ['dashboardId', 'dashboardId', 'dashboard'],
  ['teamId', 'teamId', 'team'],
  ['userId', 'userId', 'user'],
] as const;

type TargetColumn = (typeof TARGETS)[number][1];

const CREATE_KEYS = new Set<string>([
  ...TARGETS.map((t) => t[0]),
  'id',
  'folderName',
  'parentId',
  'sortOrder',
  'predefinedViewType',
  'predefinedViewTeamId',
]);
const UPDATE_KEYS = new Set(['folderName', 'parentId', 'sortOrder']);

const MAX_FOLDER_NAME = 255;
const SORT_STEP = 1000;
const PREDEFINED_VIEW_RE = /^[A-Za-z]{1,64}$/;

function typeOf(row: Row): FavoriteType {
  if (row.folderName !== null) return 'folder';
  if (row.predefinedViewType !== null) return 'predefinedView';
  for (const [, col, type] of TARGETS) if (row[col] !== null) return type;
  return 'folder';
}

function targetIdOf(row: Row): string | null {
  if (row.folderName !== null || row.predefinedViewType !== null) return null;
  for (const [, col] of TARGETS) if (row[col] !== null) return row[col];
  return null;
}

export function mapFavorite(row: Row): FavoriteDto {
  return {
    id: row.id,
    ownerId: row.ownerId,
    type: typeOf(row),
    parentId: row.parentId,
    folderName: row.folderName,
    sortOrder: row.sortOrder,
    predefinedViewType: row.predefinedViewType,
    targetId: targetIdOf(row),
    teamId: row.teamId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function checkKeys(input: Record<string, unknown>, allowed: Set<string>): void {
  const extra = Object.keys(input).find((k) => input[k] !== undefined && !allowed.has(k));
  if (extra) throw new HttpError(400, `${extra} is not supported`);
}

function optionalId(value: unknown, what: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, `${what} must be an id`);
  return value;
}

function cleanFolderName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new HttpError(400, 'folderName must not be empty');
  const name = value.trim();
  if (name.length > MAX_FOLDER_NAME)
    throw new HttpError(400, `folderName is at most ${MAX_FOLDER_NAME} characters`);
  return name;
}

function cleanSortOrder(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new HttpError(400, 'sortOrder must be a number');
  return value;
}

// What a create input points at: the columns to store, and the condition that finds
// the person's existing favorite of the same target.
function targetOf(input: Record<string, unknown>): {
  values: Partial<Record<TargetColumn | 'folderName' | 'predefinedViewType', string>>;
  same: SQL | null;
} {
  const given: [string, unknown][] = Object.entries(input).filter(
    ([k, v]) =>
      v !== undefined &&
      v !== null &&
      (k === 'folderName' || k === 'predefinedViewType' || TARGETS.some((t) => t[0] === k)),
  );
  if (given.length !== 1)
    throw new HttpError(400, 'A favorite needs exactly one target or a folderName');
  const [key, value] = given[0]!;
  if (key === 'folderName') return { values: { folderName: cleanFolderName(value) }, same: null };
  if (key === 'predefinedViewType') {
    if (typeof value !== 'string' || !PREDEFINED_VIEW_RE.test(value))
      throw new HttpError(400, 'predefinedViewType is not valid');
    const teamId = optionalId(input.predefinedViewTeamId, 'predefinedViewTeamId');
    return {
      values: { predefinedViewType: value, ...(teamId ? { teamId } : {}) },
      same: and(
        eq(favorite.predefinedViewType, value),
        teamId ? eq(favorite.teamId, teamId) : isNull(favorite.teamId),
      )!,
    };
  }
  if (input.predefinedViewTeamId != null)
    throw new HttpError(400, 'predefinedViewTeamId goes with predefinedViewType');
  const [, col] = TARGETS.find((t) => t[0] === key)!;
  const id = optionalId(value, key)!;
  return {
    values: { [col]: id },
    same: and(eq(favorite[col], id), isNull(favorite.predefinedViewType))!,
  };
}

const own = (owner: AuthUser, id: string) =>
  and(eq(favorite.id, id), eq(favorite.ownerId, owner.id))!;

async function findOwn(owner: AuthUser, id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(404, 'Favorite not found');
  const [row] = await db.select().from(favorite).where(own(owner, id));
  if (!row) throw new HttpError(404, 'Favorite not found');
  return row;
}

// The folder a favorite may be put in: one of the owner's folders.
async function folderFor(owner: AuthUser, parentId: unknown): Promise<string | null> {
  const id = optionalId(parentId, 'parentId');
  if (!id) return null;
  const [row] = await db.select().from(favorite).where(own(owner, id));
  if (!row || row.folderName === null) throw new HttpError(400, 'parentId must name a folder');
  return id;
}

// After the last favorite among the folder's (or the top level's) favorites.
async function nextSortOrder(ownerId: string, parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${favorite.sortOrder})` })
    .from(favorite)
    .where(
      and(
        eq(favorite.ownerId, ownerId),
        parentId ? eq(favorite.parentId, parentId) : isNull(favorite.parentId),
      ),
    );
  return row?.max == null ? SORT_STEP : Number(row.max) + SORT_STEP;
}

// The owner's favorite with this id while its target is visible to them.
async function isVisible(owner: AuthUser, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: favorite.id })
    .from(favorite)
    .where(and(eq(favorite.id, id), await visibleFavoritesSql(owner)));
  return !!row;
}

// The owner's favorites whose targets they can see (`where` narrows further).
export async function visibleFavoritesWhere(owner: AuthUser, where?: SQL): Promise<SQL> {
  return and(await visibleFavoritesSql(owner), where)!;
}

export async function getFavorite(owner: AuthUser, id: unknown): Promise<FavoriteDto> {
  return mapFavorite(await findOwn(owner, id));
}

export async function createFavorite(
  owner: AuthUser,
  input: Record<string, unknown>,
): Promise<FavoriteDto> {
  checkKeys(input, CREATE_KEYS);
  const { values, same } = targetOf(input);
  const sortOrder = cleanSortOrder(input.sortOrder);
  if (values.folderName !== undefined && input.parentId != null)
    throw new HttpError(400, 'Folders cannot be nested');
  const parentId = await folderFor(owner, input.parentId);

  if (same) {
    const [existing] = await db
      .select()
      .from(favorite)
      .where(and(eq(favorite.ownerId, owner.id), same));
    if (existing) return moveExisting(owner, existing, input, parentId, sortOrder);
  }

  const id = optionalId(input.id, 'id') ?? undefined;
  let row: Row | undefined;
  try {
    [row] = await db
      .insert(favorite)
      .values({
        ...(id ? { id } : {}),
        ownerId: owner.id,
        parentId,
        sortOrder: sortOrder ?? (await nextSortOrder(owner.id, parentId)),
        ...values,
      })
      .returning();
  } catch (err) {
    const code = pgErrorCode(err);
    // A concurrent create of the same target: return the one that was stored.
    if (code === '23505' && same) {
      const [existing] = await db
        .select()
        .from(favorite)
        .where(and(eq(favorite.ownerId, owner.id), same));
      if (existing) return mapFavorite(existing);
    }
    if (code === '23505') throw new HttpError(409, 'The id is already used');
    if (code === '23503') throw new HttpError(404, 'The favorite target was not found');
    throw err;
  }
  if (!(await isVisible(owner, row!.id))) {
    await db.delete(favorite).where(eq(favorite.id, row!.id));
    throw new HttpError(404, 'The favorite target was not found');
  }
  return mapFavorite(row!);
}

async function moveExisting(
  owner: AuthUser,
  existing: Row,
  input: Record<string, unknown>,
  parentId: string | null,
  sortOrder: number | undefined,
): Promise<FavoriteDto> {
  const patch: Partial<Row> = {};
  if (input.parentId !== undefined && parentId !== existing.parentId) patch.parentId = parentId;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  if (Object.keys(patch).length === 0) return mapFavorite(existing);
  const [row] = await db
    .update(favorite)
    .set({ ...patch, updatedAt: new Date() })
    .where(own(owner, existing.id))
    .returning();
  return mapFavorite(row!);
}

export async function updateFavorite(
  owner: AuthUser,
  id: unknown,
  input: Record<string, unknown>,
): Promise<FavoriteDto> {
  checkKeys(input, UPDATE_KEYS);
  const row = await findOwn(owner, id);
  const patch: Partial<Row> = {};
  if (input.folderName !== undefined) {
    if (row.folderName === null) throw new HttpError(400, 'Only a folder has a folderName');
    patch.folderName = cleanFolderName(input.folderName);
  }
  if (input.parentId !== undefined) {
    if (input.parentId !== null && row.folderName !== null)
      throw new HttpError(400, 'Folders cannot be nested');
    patch.parentId = await folderFor(owner, input.parentId);
  }
  const sortOrder = cleanSortOrder(input.sortOrder);
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  if (Object.keys(patch).length === 0) return mapFavorite(row);
  const [updated] = await db
    .update(favorite)
    .set({ ...patch, updatedAt: new Date() })
    .where(own(owner, row.id))
    .returning();
  return mapFavorite(updated!);
}

// Linear: the delete succeeds when the favorite no longer exists. Another person's
// favorite does not exist for the caller and is left alone.
export async function deleteFavorite(owner: AuthUser, id: unknown): Promise<string> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new HttpError(400, 'id must be an id');
  await db.delete(favorite).where(own(owner, id));
  return id;
}
