import { db, template } from '@repo/db';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  assertTeamAccess,
  atLeast,
  isAppUser,
  isTeamMember,
  visibleTeamIds,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { HttpError } from '../shared/lib';
import { parseIssueTemplateData, type IssueTemplateData } from './data';

// Linear's Template, issue type only. A team template belongs to its team (seen by
// whoever sees the team); a workspace template (no team) is seen by everyone who sees
// any team. Managing follows Linear: a team template by the team's members and by
// workspace admins and owners, a workspace template by owners and admins; guests and app users manage none.
// A template that is a form is managed by owners and admins only.

export type TemplateRow = typeof template.$inferSelect;

export const TEMPLATE_TYPES = ['issue'] as const;

// Whether the template is a form (has form settings). Form settings come with forms/,
// which reads them here; until then no template is a form.
export async function isFormTemplate(_id: string): Promise<boolean> {
  return false;
}

// Templates the user can see.
export function visibleTemplatesSql(userId: string): SQL {
  const teams = visibleTeamIds(userId);
  return or(inArray(template.teamId, teams), and(isNull(template.teamId), sql`EXISTS (${teams})`))!;
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  const [row] = await db.select().from(template).where(eq(template.id, id));
  return row ?? null;
}

// Throws 403 (404 for a team the user cannot see) unless the user may create, change or
// delete a template of this scope; `id` is the existing template, if any.
export async function assertTemplateManage(
  t: { teamId: string | null; id?: string },
  user: AuthUser,
): Promise<void> {
  const role = await workspaceRole(user.id);
  const admin = atLeast(role, 'admin');
  if (t.teamId) await assertTeamAccess(t.teamId, user, 'see', 'Team not found');
  if (role === 'guest' || (await isAppUser(user.id)))
    throw new HttpError(403, 'Guests cannot manage templates');
  if (!t.teamId && !admin)
    throw new HttpError(403, 'Only workspace admins can manage workspace templates');
  if (t.teamId && !admin && !(await isTeamMember(t.teamId, user.id)))
    throw new HttpError(403, "Only the team's members can manage its templates");
  if (t.id && !admin && (await isFormTemplate(t.id)))
    throw new HttpError(403, 'Only workspace admins can change a form');
}

export interface TemplateInput {
  id?: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  teamId: string | null;
  templateData: unknown;
  sortOrder?: number;
}

const cleanName = (name: unknown): string => {
  if (typeof name !== 'string' || name.trim() === '')
    throw new HttpError(400, 'name must not be empty');
  if (name.length > 255) throw new HttpError(400, 'name is longer than 255 characters');
  return name.trim();
};

export async function createTemplate(input: TemplateInput, actorId: string): Promise<TemplateRow> {
  const data: IssueTemplateData = await parseIssueTemplateData(input.templateData, input.teamId);
  const [row] = await db
    .insert(template)
    .values({
      ...(input.id ? { id: input.id } : {}),
      name: cleanName(input.name),
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      type: 'issue',
      teamId: input.teamId,
      templateData: data,
      sortOrder: input.sortOrder ?? 0,
      creatorId: actorId,
      lastUpdatedById: actorId,
    })
    .returning();
  return row!;
}

export async function updateTemplate(
  existing: TemplateRow,
  patch: Partial<Omit<TemplateInput, 'id'>>,
  actorId: string,
): Promise<TemplateRow> {
  const teamId = patch.teamId !== undefined ? patch.teamId : existing.teamId;
  // Moving a template or changing its data re-checks the data against the new team.
  const data =
    patch.templateData !== undefined || teamId !== existing.teamId
      ? await parseIssueTemplateData(patch.templateData ?? existing.templateData, teamId)
      : undefined;
  const [row] = await db
    .update(template)
    .set({
      ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(teamId !== existing.teamId ? { teamId } : {}),
      ...(data ? { templateData: data } : {}),
      lastUpdatedById: actorId,
      updatedAt: new Date(),
    })
    .where(eq(template.id, existing.id))
    .returning();
  return row!;
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.delete(template).where(eq(template.id, id));
}
