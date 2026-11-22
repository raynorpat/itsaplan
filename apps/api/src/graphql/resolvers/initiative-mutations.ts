import {
  assertCanCreateInitiative,
  assertInitiativeAccess,
  assertLeadTeamMember,
} from '../../initiatives/access';
import {
  archiveInitiative,
  createInitiative,
  getInitiative,
  unarchiveInitiative,
  updateInitiative,
  type InitiativePatch,
  type NewInitiativeInput,
} from '../../initiatives/store';
import {
  createRelation,
  deleteRelation,
  linkProject,
  unlinkProject,
  updateProjectLink,
  updateRelation,
} from '../../initiatives/links';
import {
  createInitiativeUpdate,
  setInitiativeUpdateArchived,
  updateInitiativeUpdate,
} from '../../initiatives/updates';
import { assertProjectAccess } from '../../projects/access';
import type { UpdateHealth } from '../../projects/updates';
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import {
  findInitiativeUpdate,
  findProjectLink,
  findRelation,
  toInitiative,
  toInitiativeUpdate,
  toProjectLink,
  toRelation,
} from './initiative';
import { guard, lastSyncId, onlySupported } from './mutations';

// Initiative mutations. Access: create needs projects.create in the lead team (or
// in any team for a workspace initiative), edit and archive projects.edit, delete
// projects.delete; making a team the lead team needs membership in it. Links,
// relations and updates need projects.edit on the initiatives involved; linking a
// project also needs the project to be visible.

const UPDATE_FIELDS = [
  'name',
  'description',
  'content',
  'color',
  'icon',
  'status',
  'ownerId',
  'leadTeamId',
  'priority',
  'sortOrder',
  'prioritySortOrder',
  'targetDate',
  'targetDateResolution',
  'labelIds',
];

type Input = Record<string, unknown>;

// Labels are not implemented; an empty list is accepted as a no-op.
function checkInput(input: Input, fields: string[]): void {
  onlySupported(input, fields, 'input');
  const labelIds = input.labelIds as unknown[] | null | undefined;
  if (labelIds && labelIds.length)
    throw gqlError('INVALID_INPUT', 'input.labelIds is not supported');
}

function toFields(input: Input): InitiativePatch {
  const { labelIds: _labelIds, id: _id, ...rest } = input;
  return rest as InitiativePatch;
}

// Ids given in the input must be UUIDs (INVALID_INPUT naming the field).
function checkIds(input: Input, fields: string[]): void {
  for (const f of fields)
    if (input[f] != null && !UUID_RE.test(String(input[f])))
      throw gqlError('INVALID_INPUT', `input.${f} is not a valid id`);
}

const sortOrderOf = (input: Input): number => {
  if (typeof input.sortOrder !== 'number')
    throw gqlError('INVALID_INPUT', 'input.sortOrder must be a number');
  return input.sortOrder;
};

const deleted = (entityId: string) => ({ success: true, lastSyncId: lastSyncId(), entityId });

const payload = async (id: string) => ({
  success: true,
  lastSyncId: lastSyncId(),
  initiative: toInitiative((await getInitiative(id))!),
});

export const initiativeMutationResolvers = {
  Mutation: {
    initiativeCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        checkInput(input, [...UPDATE_FIELDS, 'id']);
        if (input.id !== undefined && !UUID_RE.test(String(input.id)))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        const leadTeamId = (input.leadTeamId as string | null | undefined) ?? null;
        if (leadTeamId) await assertLeadTeamMember(ctx.user.id, leadTeamId);
        await assertCanCreateInitiative(ctx.user.id, leadTeamId);
        const created = await createInitiative(
          { ...toFields(input), id: input.id as string | undefined } as NewInitiativeInput,
          ctx.user.id,
        );
        return payload(created.id);
      }),
    initiativeUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        checkInput(input, UPDATE_FIELDS);
        const found = await assertInitiativeAccess(id, ctx.user.id, 'edit');
        const fields = toFields(input);
        // Linear: an empty or null content leaves the overview unchanged.
        if (fields.content === null || fields.content === '') delete fields.content;
        if (fields.leadTeamId && fields.leadTeamId !== found.leadTeamId)
          await assertLeadTeamMember(ctx.user.id, fields.leadTeamId);
        await updateInitiative(found.id, fields, ctx.user.id);
        return payload(found.id);
      }),
    initiativeArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await assertInitiativeAccess(id, ctx.user.id, 'edit');
        const archived = await archiveInitiative(found.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toInitiative(archived) };
      }),
    initiativeUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await assertInitiativeAccess(id, ctx.user.id, 'edit');
        const restored = await unarchiveInitiative(found.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toInitiative(restored) };
      }),
    // Linear moves a deleted initiative to the trash: archived and trashed.
    initiativeDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await assertInitiativeAccess(id, ctx.user.id, 'delete');
        await archiveInitiative(found.id, ctx.user.id, { trash: true });
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),

    initiativeToProjectCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, ['initiativeId', 'projectId', 'sortOrder', 'id'], 'input');
        checkIds(input, ['initiativeId', 'projectId', 'id']);
        const found = await assertInitiativeAccess(String(input.initiativeId), ctx.user.id, 'edit');
        await assertProjectAccess(String(input.projectId), ctx.user.id, 'read');
        const link = await linkProject(
          {
            initiativeId: found.id,
            projectId: String(input.projectId),
            sortOrder: input.sortOrder as number | undefined,
            id: input.id as string | undefined,
          },
          ctx.user.id,
        );
        return {
          success: true,
          lastSyncId: lastSyncId(),
          initiativeToProject: toProjectLink(link),
        };
      }),
    initiativeToProjectUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['sortOrder'], 'input');
        const link = await findProjectLink(id, ctx);
        await assertInitiativeAccess(link.initiativeId, ctx.user.id, 'edit');
        const updated = await updateProjectLink(
          link.id,
          { sortOrder: sortOrderOf(input) },
          ctx.user.id,
        );
        return {
          success: true,
          lastSyncId: lastSyncId(),
          initiativeToProject: toProjectLink(updated),
        };
      }),
    initiativeToProjectDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const link = await findProjectLink(id, ctx);
        await assertInitiativeAccess(link.initiativeId, ctx.user.id, 'edit');
        await unlinkProject(link.id, ctx.user.id);
        return deleted(link.id);
      }),
    initiativeRelationCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, ['initiativeId', 'relatedInitiativeId', 'sortOrder', 'id'], 'input');
        checkIds(input, ['initiativeId', 'relatedInitiativeId', 'id']);
        const parent = await assertInitiativeAccess(
          String(input.initiativeId),
          ctx.user.id,
          'edit',
        );
        const child = await assertInitiativeAccess(
          String(input.relatedInitiativeId),
          ctx.user.id,
          'edit',
        );
        const relation = await createRelation(
          {
            initiativeId: parent.id,
            relatedInitiativeId: child.id,
            sortOrder: input.sortOrder as number | undefined,
            id: input.id as string | undefined,
          },
          ctx.user.id,
        );
        return {
          success: true,
          lastSyncId: lastSyncId(),
          initiativeRelation: toRelation(relation),
        };
      }),
    initiativeRelationUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['sortOrder'], 'input');
        const relation = await findRelation(id, ctx);
        await assertInitiativeAccess(relation.initiativeId, ctx.user.id, 'edit');
        const updated = await updateRelation(
          relation.id,
          { sortOrder: sortOrderOf(input) },
          ctx.user.id,
        );
        return { success: true, lastSyncId: lastSyncId(), initiativeRelation: toRelation(updated) };
      }),
    initiativeRelationDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const relation = await findRelation(id, ctx);
        await assertInitiativeAccess(relation.initiativeId, ctx.user.id, 'edit');
        await assertInitiativeAccess(relation.relatedInitiativeId, ctx.user.id, 'edit');
        await deleteRelation(relation.id, ctx.user.id);
        return deleted(relation.id);
      }),
    initiativeUpdateCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, ['initiativeId', 'body', 'health', 'id'], 'input');
        checkIds(input, ['initiativeId', 'id']);
        const found = await assertInitiativeAccess(String(input.initiativeId), ctx.user.id, 'edit');
        const created = await createInitiativeUpdate(found.id, ctx.user.id, {
          body: (input.body as string | null | undefined) ?? '',
          health: (input.health as UpdateHealth | null | undefined) ?? undefined,
          id: input.id as string | undefined,
        });
        return {
          success: true,
          lastSyncId: lastSyncId(),
          initiativeUpdate: toInitiativeUpdate(created),
        };
      }),
    initiativeUpdateUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['body', 'health'], 'input');
        const found = await findInitiativeUpdate(id, ctx);
        await assertInitiativeAccess(found.initiativeId, ctx.user.id, 'edit');
        const patch: { body?: string; health?: UpdateHealth } = {};
        if (input.body != null) patch.body = input.body as string;
        if (input.health != null) patch.health = input.health as UpdateHealth;
        const updated = await updateInitiativeUpdate(found.id, patch, ctx.user.id);
        return {
          success: true,
          lastSyncId: lastSyncId(),
          initiativeUpdate: toInitiativeUpdate(updated),
        };
      }),
    initiativeUpdateArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findInitiativeUpdate(id, ctx);
        await assertInitiativeAccess(found.initiativeId, ctx.user.id, 'edit');
        const archived = await setInitiativeUpdateArchived(found.id, true, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toInitiativeUpdate(archived) };
      }),
    initiativeUpdateUnarchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findInitiativeUpdate(id, ctx);
        await assertInitiativeAccess(found.initiativeId, ctx.user.id, 'edit');
        const restored = await setInitiativeUpdateArchived(found.id, false, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entity: toInitiativeUpdate(restored) };
      }),
  },
};
