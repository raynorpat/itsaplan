import { db, customField, customFieldOption } from '@repo/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

// Data access for custom fields and their options. Every field belongs to a
// team. A field with issue_type_id NULL is team-wide (applies to every
// issue in its team); a field with issue_type_id set only applies to issues
// of that type. Deleting a field removes its options and any values/selections
// set on issues (ON DELETE CASCADE on the field_id foreign keys).

export type CustomFieldType =
  'text' | 'markdown' | 'url' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select';

export interface CustomFieldOptionRow {
  id: string;
  value: string;
  color: string;
  position: number;
}

export interface CustomFieldRow {
  id: string;
  issueTypeId: string | null;
  name: string;
  fieldType: CustomFieldType;
  showInBody: boolean;
  position: number;
  options: CustomFieldOptionRow[];
}

function mapField(
  row: typeof customField.$inferSelect,
  options: CustomFieldOptionRow[],
): CustomFieldRow {
  return {
    id: row.id,
    issueTypeId: row.issueTypeId,
    name: row.name,
    fieldType: row.fieldType as CustomFieldType,
    showInBody: row.showInBody,
    position: row.position,
    options,
  };
}

// Loads the options for the given field ids, grouped by field, each list ordered
// by position. Returns an empty map for no ids.
async function optionsByField(fieldIds: string[]): Promise<Map<string, CustomFieldOptionRow[]>> {
  const byField = new Map<string, CustomFieldOptionRow[]>();
  if (fieldIds.length === 0) return byField;
  const rows = await db
    .select()
    .from(customFieldOption)
    .where(inArray(customFieldOption.fieldId, fieldIds))
    .orderBy(customFieldOption.position);
  for (const o of rows) {
    let list = byField.get(o.fieldId);
    if (!list) byField.set(o.fieldId, (list = []));
    list.push({ id: o.id, value: o.value, color: o.color, position: o.position });
  }
  return byField;
}

// Fields of one team. With issueTypeId, returns the team-wide fields plus
// that type's own fields; without it, only the team-wide fields. With allTypes,
// returns every field of the team regardless of type scope (used by the board
// payload, which filters by type on the client).
export async function listCustomFields(
  teamId: string,
  opts: { issueTypeId?: string; allTypes?: boolean } = {},
): Promise<CustomFieldRow[]> {
  const scope = opts.allTypes
    ? undefined
    : opts.issueTypeId != null
      ? or(isNull(customField.issueTypeId), eq(customField.issueTypeId, opts.issueTypeId))
      : isNull(customField.issueTypeId);
  const fields = await db
    .select()
    .from(customField)
    .where(scope ? and(eq(customField.teamId, teamId), scope) : eq(customField.teamId, teamId))
    .orderBy(asc(customField.position));
  const options = await optionsByField(fields.map((f) => f.id));
  return fields.map((f) => mapField(f, options.get(f.id) ?? []));
}

// One field by id, scoped to its team so a field id from another team is
// not matched. Returns null when no field of that id exists in the team.
export async function getCustomFieldById(
  teamId: string,
  id: string,
): Promise<CustomFieldRow | null> {
  const rows = await db
    .select()
    .from(customField)
    .where(and(eq(customField.id, id), eq(customField.teamId, teamId)));
  if (!rows[0]) return null;
  const options = await optionsByField([id]);
  return mapField(rows[0], options.get(id) ?? []);
}

export async function createCustomField(input: {
  teamId: string;
  issueTypeId?: string | null;
  name: string;
  fieldType: CustomFieldType;
  showInBody?: boolean;
  options?: string[];
}): Promise<CustomFieldRow> {
  const issueTypeId = input.issueTypeId ?? null;
  const [{ pos }] = await db
    .select({ pos: sql<number>`COALESCE(MAX(${customField.position}), -1) + 1` })
    .from(customField)
    .where(
      and(
        eq(customField.teamId, input.teamId),
        sql`${customField.issueTypeId} IS NOT DISTINCT FROM ${issueTypeId}`,
      ),
    );
  const [row] = await db
    .insert(customField)
    .values({
      teamId: input.teamId,
      issueTypeId,
      name: input.name,
      fieldType: input.fieldType,
      showInBody: input.showInBody ?? false,
      position: Number(pos),
    })
    .returning({ id: customField.id });
  const options = input.options ?? [];
  if (options.length > 0) {
    await db
      .insert(customFieldOption)
      .values(options.map((value, index) => ({ fieldId: row.id, value, position: index })));
  }
  return (await getCustomFieldById(input.teamId, row.id))!;
}

// Updates a field, scoped to its team. Returns null when no field of that id
// exists in the team.
export async function updateCustomField(
  teamId: string,
  id: string,
  patch: { name?: string; showInBody?: boolean },
): Promise<CustomFieldRow | null> {
  const scope = and(eq(customField.id, id), eq(customField.teamId, teamId));
  const set: Partial<typeof customField.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.showInBody !== undefined) set.showInBody = patch.showInBody;
  if (Object.keys(set).length > 0) {
    const updated = await db
      .update(customField)
      .set(set)
      .where(scope)
      .returning({ id: customField.id });
    if (updated.length === 0) return null;
  } else {
    const rows = await db.select({ id: customField.id }).from(customField).where(scope);
    if (rows.length === 0) return null;
  }
  return getCustomFieldById(teamId, id);
}

// Deletes a field, scoped to its team. Returns true when a row was removed.
export async function deleteCustomField(teamId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(customField)
    .where(and(eq(customField.id, id), eq(customField.teamId, teamId)))
    .returning({ id: customField.id });
  return deleted.length > 0;
}
