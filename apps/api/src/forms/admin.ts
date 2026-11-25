import { db, formSettings, team, template } from '@repo/db';
import { getActiveSession, type FormsHandlers } from '@repo/auth';
import { asc, eq } from 'drizzle-orm';
import { assertWorkspaceRole } from '../shared/access';
import { HttpError, iso, pgErrorCode, UUID_RE } from '../shared/lib';
import { getTemplate } from '../templates/store';
import { boardMayShowForm, boardsByIds } from './settings';

// The instance plugin's form endpoints (/api/auth/instance/forms/*), owners and admins
// only: the publishing settings of a form, which Linear's schema has no place for.
// The template itself is written through GraphQL (templateCreate / templateUpdate).

export interface FormDto {
  templateId: string;
  name: string;
  teamId: string;
  teamName: string;
  slug: string;
  intro: string;
  linkEnabled: boolean;
  boardIds: string[];
  updatedAt: string;
}

const SLUG_RE = /^[a-z0-9-]{1,48}$/;
// Paths of the confirmation step under /portal/forms/ and /forms/<slug>/.
const RESERVED_SLUGS = new Set(['confirm', 'confirm-info']);
const MAX_INTRO = 10_000;
const MAX_BOARDS = 100;

async function admin(headers: Headers) {
  const session = await getActiveSession(headers);
  if (!session) throw new HttpError(401, 'Authentication required');
  return assertWorkspaceRole(session.user, 'admin');
}

const fields = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

function templateId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, 'templateId must be a template id');
  return value;
}

// The settings to store for a form of `teamId`, checked: slug, intro, link switch and
// boards (each a team board of the form's team or a project board including it).
async function parseSettings(input: Record<string, unknown>, teamId: string) {
  const { slug, intro = '', linkEnabled = false, boardIds = [] } = input;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug))
    throw new HttpError(400, 'slug must be 1–48 lowercase letters, digits or dashes');
  if (RESERVED_SLUGS.has(slug)) throw new HttpError(400, 'This form address is reserved');
  if (typeof intro !== 'string' || intro.length > MAX_INTRO)
    throw new HttpError(400, `intro must be text of at most ${MAX_INTRO} characters`);
  if (typeof linkEnabled !== 'boolean') throw new HttpError(400, 'linkEnabled must be a boolean');
  if (
    !Array.isArray(boardIds) ||
    boardIds.length > MAX_BOARDS ||
    boardIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
  )
    throw new HttpError(400, 'boardIds must be a list of board ids');
  const ids = [...new Set(boardIds as string[])];
  const boards = await boardsByIds(ids);
  if (boards.length !== ids.length) throw new HttpError(400, 'A board was not found');
  for (const board of boards)
    if (!(await boardMayShowForm(board, teamId)))
      throw new HttpError(
        400,
        `The ${board.name} board does not show the form's team, so the form cannot be on it`,
      );
  return { slug, intro, linkEnabled, boardIds: ids };
}

function rethrowSlug(err: unknown): never {
  if (pgErrorCode(err) === '23505') throw new HttpError(409, 'This form address is taken');
  throw err;
}

export const formsHandlers: FormsHandlers = {
  list: async (headers) => {
    await admin(headers);
    const rows = await db
      .select({ settings: formSettings, name: template.name, teamId: team.id, teamName: team.name })
      .from(formSettings)
      .innerJoin(template, eq(template.id, formSettings.templateId))
      .innerJoin(team, eq(team.id, template.teamId))
      .orderBy(asc(template.name));
    const forms: FormDto[] = rows.map((r) => ({
      templateId: r.settings.templateId,
      name: r.name,
      teamId: r.teamId,
      teamName: r.teamName,
      slug: r.settings.slug,
      intro: r.settings.intro,
      linkEnabled: r.settings.linkEnabled,
      boardIds: r.settings.boardIds,
      updatedAt: iso(r.settings.updatedAt)!,
    }));
    return { forms };
  },
  // With `validateOnly`, checks the settings and stores nothing; for a form not created
  // yet it takes the team (`teamId`) instead of `templateId`, so the editor can check
  // the address and boards before it creates the template.
  saveSettings: async (headers, body) => {
    await admin(headers);
    const input = fields(body);
    const validateOnly = input.validateOnly === true;
    let id: string | null = null;
    let teamId: string;
    if (validateOnly && input.templateId === undefined) {
      if (typeof input.teamId !== 'string' || !UUID_RE.test(input.teamId))
        throw new HttpError(400, 'teamId must be a team id');
      teamId = input.teamId;
    } else {
      const found = await getTemplate(templateId(input.templateId));
      if (!found) throw new HttpError(404, 'Template not found');
      if (!found.teamId) throw new HttpError(400, 'A form must be a team template');
      id = found.id;
      teamId = found.teamId;
    }
    const [owner] = await db.select().from(team).where(eq(team.id, teamId));
    if (!owner || owner.visibility !== 'public')
      throw new HttpError(400, "A form's team must be public");
    const values = await parseSettings(input, teamId);
    if (validateOnly) {
      const [taken] = await db
        .select({ templateId: formSettings.templateId })
        .from(formSettings)
        .where(eq(formSettings.slug, values.slug));
      if (taken && taken.templateId !== id) throw new HttpError(409, 'This form address is taken');
      return { success: true };
    }
    await db
      .insert(formSettings)
      .values({ templateId: id!, ...values })
      .onConflictDoUpdate({
        target: formSettings.templateId,
        set: { ...values, updatedAt: new Date() },
      })
      .catch(rethrowSlug);
    return { success: true };
  },
  deleteForm: async (headers, body) => {
    await admin(headers);
    const id = templateId(fields(body).templateId);
    const [row] = await db
      .select({ id: formSettings.templateId })
      .from(formSettings)
      .where(eq(formSettings.templateId, id));
    if (!row) throw new HttpError(404, 'Form not found');
    // Deleting the template deletes its settings (and later its pending submissions).
    await db.delete(template).where(eq(template.id, id));
    return { success: true };
  },
};
