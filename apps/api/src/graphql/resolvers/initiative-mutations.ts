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
import { UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { gqlError } from '../errors';
import { toInitiative } from './initiative';
import { guard, lastSyncId, onlySupported } from './mutations';

// Initiative mutations. Access: create needs projects.create in the lead team (or
// in any team for a workspace initiative), edit and archive projects.edit, delete
// projects.delete; making a team the lead team needs membership in it.

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
  },
};
