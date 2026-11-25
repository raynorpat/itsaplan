import { db, template } from '@repo/db';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { HttpError, UUID_RE } from '../../shared/lib';
import { hasFormFields } from '../../templates/data';
import {
  assertTemplateManage,
  createTemplate,
  deleteTemplate,
  isFormTemplate,
  updateTemplate,
  visibleTemplatesSql,
  type TemplateRow,
} from '../../templates/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { loaders } from '../loaders';
import { templateFilterSql } from '../template-filter';
import { userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { getOrganization } from './organization';
import { findTeam, toTeam } from './team';

// Linear's Template (issue templates only, templates/). Team templates follow their
// team's visibility; workspace templates are seen by anyone who sees a team.

const toTemplate = (row: TemplateRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  color: row.color,
  type: row.type,
  templateData: row.templateData,
  sortOrder: row.sortOrder,
  hasFormFields: hasFormFields(row.templateData),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: row.archivedAt?.toISOString() ?? null,
  lastAppliedAt: null,
  content: null,
  inheritedFrom: null,
  pipeline: null,
  // Read by the relation resolvers; not schema fields.
  teamId: row.teamId,
  creatorId: row.creatorId,
  lastUpdatedById: row.lastUpdatedById,
});

type GraphQLTemplate = ReturnType<typeof toTemplate>;
type ListArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };
type Input = Record<string, unknown>;

function listTemplates(where: SQL | undefined, args: ListArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: template.id, createdAt: template.createdAt, updatedAt: template.updatedAt },
    and(
      visibleTemplatesSql(ctx.user.id),
      where,
      args.includeArchived ? undefined : isNull(template.archivedAt),
      templateFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(template)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    toTemplate,
  );
}

async function findTemplate(id: string, ctx: GraphQLContext): Promise<TemplateRow> {
  const [row] = UUID_RE.test(id)
    ? await db
        .select()
        .from(template)
        .where(and(eq(template.id, id), visibleTemplatesSql(ctx.user.id)))
    : [];
  if (!row) throw gqlError('ENTITY_NOT_FOUND', `Template ${id} not found`);
  return row;
}

async function teamIdInput(value: unknown, ctx: GraphQLContext): Promise<string | null> {
  if (value == null) return null;
  return (await findTeam(String(value), ctx.user.id)).id;
}

const optionalText = (value: unknown): string | null | undefined =>
  value === undefined ? undefined : value === null ? null : String(value);

// GraphQL input objects have no prototype; store a plain copy.
const plain = (value: unknown): unknown =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const payload = (row: TemplateRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  template: toTemplate(row),
});

export const templateResolvers = {
  Query: {
    template: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toTemplate(await findTemplate(id, ctx))),
    // Linear's `templates` is the viewer's whole list, unpaged.
    templates: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const rows = await db
        .select()
        .from(template)
        .where(and(visibleTemplatesSql(ctx.user.id), isNull(template.archivedAt)))
        .orderBy(asc(template.sortOrder), asc(template.createdAt));
      return rows.map(toTemplate);
    },
    templateSearch: async (
      _: unknown,
      args: { filter?: unknown; first?: number | null; includeArchived?: boolean | null },
      ctx: GraphQLContext,
    ) => {
      const first = Math.min(Math.max(args.first ?? 50, 1), 250);
      const rows = await db
        .select()
        .from(template)
        .where(
          and(
            visibleTemplatesSql(ctx.user.id),
            args.includeArchived ? undefined : isNull(template.archivedAt),
            templateFilterSql(args.filter),
          ),
        )
        .orderBy(asc(template.sortOrder), asc(template.createdAt))
        .limit(first);
      return rows.map(toTemplate);
    },
  },
  Team: {
    templates: (t: { id: string }, args: ListArgs, ctx: GraphQLContext) =>
      listTemplates(eq(template.teamId, t.id), args, ctx),
  },
  Organization: {
    // Workspace templates (no team).
    templates: (_: unknown, args: ListArgs, ctx: GraphQLContext) =>
      listTemplates(isNull(template.teamId), args, ctx),
  },
  Template: {
    team: async (t: GraphQLTemplate, _: unknown, ctx: GraphQLContext) => {
      if (!t.teamId) return null;
      const row = await loaders(ctx).team.load(t.teamId);
      return row ? toTeam(row) : null;
    },
    creator: (t: GraphQLTemplate, _: unknown, ctx: GraphQLContext) =>
      userById(t.creatorId, ctx.user.id),
    lastUpdatedBy: (t: GraphQLTemplate, _: unknown, ctx: GraphQLContext) =>
      userById(t.lastUpdatedById, ctx.user.id),
    organization: () => getOrganization(),
  },
  Mutation: {
    templateCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(
          input,
          [
            'id',
            'name',
            'description',
            'icon',
            'color',
            'teamId',
            'templateData',
            'type',
            'sortOrder',
          ],
          'input',
        );
        if (input.type !== 'issue')
          throw gqlError('INVALID_INPUT', 'input.type: only issue templates are supported');
        if (input.id != null && !UUID_RE.test(String(input.id)))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        const teamId = await teamIdInput(input.teamId, ctx);
        await assertTemplateManage({ teamId }, ctx.user);
        const row = await createTemplate(
          {
            id: input.id == null ? undefined : String(input.id),
            name: input.name as string,
            description: optionalText(input.description),
            icon: optionalText(input.icon),
            color: optionalText(input.color),
            teamId,
            templateData: plain(input.templateData),
            sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
          },
          ctx.user.id,
        );
        return payload(row);
      }),
    templateUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          ['name', 'description', 'icon', 'color', 'teamId', 'templateData', 'sortOrder'],
          'input',
        );
        const existing = await findTemplate(id, ctx);
        await assertTemplateManage({ teamId: existing.teamId, id: existing.id }, ctx.user);
        const teamId =
          input.teamId === undefined ? undefined : await teamIdInput(input.teamId, ctx);
        if (teamId !== undefined && teamId !== existing.teamId) {
          // A form's state, labels and boards belong to its team.
          if (await isFormTemplate(existing.id))
            throw new HttpError(400, "A form's team cannot be changed");
          await assertTemplateManage({ teamId, id: existing.id }, ctx.user);
        }
        const row = await updateTemplate(
          existing,
          {
            name: input.name === undefined ? undefined : (input.name as string),
            description: optionalText(input.description),
            icon: optionalText(input.icon),
            color: optionalText(input.color),
            teamId,
            templateData: plain(input.templateData),
            sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
          },
          ctx.user.id,
        );
        return payload(row);
      }),
    templateDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const existing = await findTemplate(id, ctx);
        await assertTemplateManage({ teamId: existing.teamId, id: existing.id }, ctx.user);
        await deleteTemplate(existing.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: existing.id };
      }),
  },
};
