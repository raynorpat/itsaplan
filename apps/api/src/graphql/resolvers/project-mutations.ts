import {
  db,
  projectLabel,
  projectMilestone,
  projectUpdate,
  PROJECT_STATUSES,
  type ProjectStatusType,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { assertProjectAccess, teamsGranting } from '../../projects/access';
import {
  createProject,
  deleteProject,
  setProjectArchived,
  setProjectTeams,
  updateProject,
  type ProjectPatch,
} from '../../projects/store';
import {
  createMilestone,
  deleteMilestone,
  getMilestone,
  updateMilestone,
} from '../../projects/milestones';
import {
  createUpdate,
  deleteUpdate,
  getUpdate,
  updateUpdate,
  type UpdateHealth,
} from '../../projects/updates';
import {
  assertLabelManager,
  createProjectLabel,
  deleteProjectLabel,
  getProjectLabel,
  updateProjectLabel,
} from '../../project-labels/store';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findProject, toLabel, toMilestone, toUpdate } from './project';

// Project, milestone, update and label mutations. Access follows REST: a project
// is changed through a team that grants the projects permission (assertProjectAccess),
// labels by any team member.

const STATUS_TYPE_BY_ID = new Map<string, ProjectStatusType>(
  PROJECT_STATUSES.map((s) => [s.id, s.type]),
);
const HEALTH = new Set(['onTrack', 'atRisk', 'offTrack']);

type ProjectInput = Record<string, unknown> & {
  name?: string;
  description?: string;
  content?: string;
  color?: string | null;
  icon?: string | null;
  leadId?: string | null;
  priority?: number;
  startDate?: string | null;
  targetDate?: string | null;
  statusId?: string;
  sortOrder?: number;
  labelIds?: string[];
  teamIds?: string[];
};

const PROJECT_FIELDS = [
  'name',
  'description',
  'content',
  'color',
  'icon',
  'leadId',
  'priority',
  'startDate',
  'targetDate',
  'statusId',
  'sortOrder',
  'labelIds',
];

function toProjectPatch(input: ProjectInput): ProjectPatch {
  if (input.name !== undefined && !input.name)
    throw gqlError('INVALID_INPUT', 'input.name must not be empty');
  if (
    input.priority != null &&
    !(Number.isInteger(input.priority) && input.priority >= 0 && input.priority <= 4)
  )
    throw gqlError('INVALID_INPUT', 'input.priority must be an integer from 0 to 4');
  let status: ProjectStatusType | undefined;
  if (input.statusId !== undefined) {
    status = STATUS_TYPE_BY_ID.get(input.statusId);
    if (!status) throw gqlError('INVALID_INPUT', 'input.statusId is not a project status');
  }
  const patch: ProjectPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description ?? '';
  if (input.content !== undefined) patch.content = input.content ?? '';
  if (input.color !== undefined) patch.color = input.color;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.leadId !== undefined) patch.leadUserId = input.leadId;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate;
  if (status) patch.status = status;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.labelIds !== undefined) patch.labelIds = input.labelIds;
  return patch;
}

// Access to a project for `action` through its teams (404 when not visible).
const projectAccess = (
  projectId: string,
  ctx: GraphQLContext,
  action: 'read' | 'edit' | 'delete',
) => assertProjectAccess(projectId, ctx.user.id, action);

export const projectMutationResolvers = {
  Mutation: {
    projectCreate: (
      _: unknown,
      { input }: { input: ProjectInput & { teamIds: string[] } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['teamIds', ...PROJECT_FIELDS], 'input');
        if (!input.name) throw gqlError('INVALID_INPUT', 'input.name is required');
        if (!input.teamIds?.length)
          throw gqlError('INVALID_INPUT', 'input.teamIds needs at least one team');
        const creatable = await teamsGranting(ctx.user.id, 'create');
        if (!input.teamIds.every((t) => creatable.includes(t)))
          throw gqlError(
            'FORBIDDEN',
            'You do not have permission to create projects in every team listed',
          );
        const patch = toProjectPatch(input);
        const created = await createProject(
          input.teamIds,
          { ...patch, name: input.name },
          ctx.user.id,
        );
        return {
          success: true,
          lastSyncId: lastSyncId(),
          project: await findProject(created.id, ctx),
        };
      }),

    projectUpdate: (
      _: unknown,
      { id, input }: { id: string; input: ProjectInput },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['teamIds', ...PROJECT_FIELDS], 'input');
        const found = await findProject(id, ctx);
        const access = await projectAccess(found.id, ctx, 'edit');
        const patch = toProjectPatch(input);
        if (input.teamIds !== undefined) {
          const editable = await teamsGranting(ctx.user.id, 'edit');
          await setProjectTeams(found.id, access.readableTeamIds, editable, input.teamIds);
        }
        if (Object.keys(patch).length) await updateProject(found.id, patch, ctx.user.id);
        return {
          success: true,
          lastSyncId: lastSyncId(),
          project: await findProject(found.id, ctx),
        };
      }),

    projectArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findProject(id, ctx);
        await projectAccess(found.id, ctx, 'edit');
        await setProjectArchived(found.id, true);
        return {
          success: true,
          lastSyncId: lastSyncId(),
          entity: await findProject(found.id, ctx),
        };
      }),

    projectUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findProject(id, ctx);
        await projectAccess(found.id, ctx, 'edit');
        await setProjectArchived(found.id, false);
        return {
          success: true,
          lastSyncId: lastSyncId(),
          entity: await findProject(found.id, ctx),
        };
      }),

    // There is no trash: delete removes the project; its issues keep existing.
    projectDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findProject(id, ctx);
        await projectAccess(found.id, ctx, 'delete');
        await deleteProject(found.id);
        return { success: true, lastSyncId: lastSyncId(), entity: found };
      }),

    projectMilestoneCreate: (
      _: unknown,
      {
        input,
      }: {
        input: Record<string, unknown> & {
          projectId: string;
          name: string;
          description?: string;
          targetDate?: string | null;
          sortOrder?: number;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          ['projectId', 'name', 'description', 'targetDate', 'sortOrder'],
          'input',
        );
        if (!input.name) throw gqlError('INVALID_INPUT', 'input.name is required');
        const found = await findProject(input.projectId, ctx);
        await projectAccess(found.id, ctx, 'edit');
        const m = await createMilestone(found.id, input);
        const [row] = await db.select().from(projectMilestone).where(eq(projectMilestone.id, m.id));
        return { success: true, lastSyncId: lastSyncId(), projectMilestone: toMilestone(row!) };
      }),

    projectMilestoneUpdate: (
      _: unknown,
      {
        id,
        input,
      }: {
        id: string;
        input: Record<string, unknown> & {
          name?: string;
          description?: string;
          targetDate?: string | null;
          sortOrder?: number;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'description', 'targetDate', 'sortOrder'], 'input');
        if (input.name === '') throw gqlError('INVALID_INPUT', 'input.name must not be empty');
        const m = await getMilestone(id);
        if (!m) throw gqlError('ENTITY_NOT_FOUND', `Project milestone ${id} not found`);
        await projectAccess(m.projectId, ctx, 'edit');
        await updateMilestone(id, input);
        const [row] = await db.select().from(projectMilestone).where(eq(projectMilestone.id, id));
        return { success: true, lastSyncId: lastSyncId(), projectMilestone: toMilestone(row!) };
      }),

    projectMilestoneDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const m = await getMilestone(id);
        if (!m) throw gqlError('ENTITY_NOT_FOUND', `Project milestone ${id} not found`);
        await projectAccess(m.projectId, ctx, 'edit');
        await deleteMilestone(id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),

    // Any member who can see the project may post an update.
    projectUpdateCreate: (
      _: unknown,
      {
        input,
      }: { input: Record<string, unknown> & { projectId: string; body?: string; health?: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['projectId', 'body', 'health'], 'input');
        if (!input.body) throw gqlError('INVALID_INPUT', 'input.body is required');
        const health = input.health ?? 'onTrack';
        if (!HEALTH.has(health))
          throw gqlError('INVALID_INPUT', 'input.health is not a health value');
        const found = await findProject(input.projectId, ctx);
        const u = await createUpdate(found.id, ctx.user.id, {
          body: input.body,
          health: health as UpdateHealth,
        });
        const [row] = await db.select().from(projectUpdate).where(eq(projectUpdate.id, u.id));
        return { success: true, lastSyncId: lastSyncId(), projectUpdate: toUpdate(row!) };
      }),

    // Only the author edits an update.
    projectUpdateUpdate: (
      _: unknown,
      {
        id,
        input,
      }: { id: string; input: Record<string, unknown> & { body?: string; health?: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['body', 'health'], 'input');
        if (input.health !== undefined && !HEALTH.has(input.health))
          throw gqlError('INVALID_INPUT', 'input.health is not a health value');
        const u = await getUpdate(id);
        if (!u) throw gqlError('ENTITY_NOT_FOUND', `Project update ${id} not found`);
        await projectAccess(u.projectId, ctx, 'read');
        if (u.userId !== ctx.user.id)
          throw gqlError('FORBIDDEN', 'Only the author can edit an update');
        await updateUpdate(id, {
          body: input.body,
          health: input.health as UpdateHealth | undefined,
        });
        const [row] = await db.select().from(projectUpdate).where(eq(projectUpdate.id, id));
        return { success: true, lastSyncId: lastSyncId(), projectUpdate: toUpdate(row!) };
      }),

    // The author, or anyone with projects.edit on the project, deletes an update.
    projectUpdateDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const u = await getUpdate(id);
        if (!u) throw gqlError('ENTITY_NOT_FOUND', `Project update ${id} not found`);
        await projectAccess(u.projectId, ctx, u.userId === ctx.user.id ? 'read' : 'edit');
        await deleteUpdate(id);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),

    projectLabelCreate: (
      _: unknown,
      {
        input,
      }: {
        input: Record<string, unknown> & {
          name: string;
          color?: string;
          description?: string | null;
          parentId?: string | null;
          isGroup?: boolean;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'color', 'description', 'parentId', 'isGroup'], 'input');
        if (!input.name) throw gqlError('INVALID_INPUT', 'input.name is required');
        await assertLabelManager(ctx.user.id);
        const l = await createProjectLabel(input);
        const [row] = await db.select().from(projectLabel).where(eq(projectLabel.id, l.id));
        return { success: true, lastSyncId: lastSyncId(), projectLabel: toLabel(row!) };
      }),

    projectLabelUpdate: (
      _: unknown,
      {
        id,
        input,
      }: {
        id: string;
        input: Record<string, unknown> & {
          name?: string;
          color?: string;
          description?: string | null;
          parentId?: string | null;
        };
      },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'color', 'description', 'parentId'], 'input');
        if (input.name === '') throw gqlError('INVALID_INPUT', 'input.name must not be empty');
        await assertLabelManager(ctx.user.id);
        if (!(await getProjectLabel(id)))
          throw gqlError('ENTITY_NOT_FOUND', `Project label ${id} not found`);
        await updateProjectLabel(id, input);
        const [row] = await db.select().from(projectLabel).where(eq(projectLabel.id, id));
        return { success: true, lastSyncId: lastSyncId(), projectLabel: toLabel(row!) };
      }),

    projectLabelDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await assertLabelManager(ctx.user.id);
        if (!(await deleteProjectLabel(id)))
          throw gqlError('ENTITY_NOT_FOUND', `Project label ${id} not found`);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),
  },
};
