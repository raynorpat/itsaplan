import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData, signUpAs, type Data } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { createView } from '../../store';

// Saved team views (Linear's CustomView): create and list per team, update only
// the given fields, filterData kept verbatim, icon nullable, and access through
// the team.

const MISSING = '00000000-0000-4000-8000-000000000000';
const VIEW = 'id name icon filterData team { id }';

type Res = Awaited<ReturnType<typeof gql>>;
const code = (res: Res) => res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id };
}

function create(u: TestUser, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($input: CustomViewCreateInput!) { customViewCreate(input: $input) { customView { ${VIEW} } } }`,
    { input },
  );
}

async function created(u: TestUser, input: Record<string, unknown>) {
  const res = await create(u, input);
  if (res.body.errors) throw new Error(res.body.errors[0]!.message);
  return (res.body.data as { customViewCreate: { customView: Data } }).customViewCreate.customView;
}

function update(u: TestUser, id: string, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($id: String!, $input: CustomViewUpdateInput!) {
      customViewUpdate(id: $id, input: $input) { customView { ${VIEW} } } }`,
    { id, input },
  );
}

const updated = (res: Res) =>
  (res.body.data as { customViewUpdate: { customView: Data } }).customViewUpdate.customView;

const list = async (u: TestUser) =>
  (await gqlData(u, '{ customViews { nodes { id name filterData } } }')).customViews.nodes as {
    id: string;
    name: string;
    filterData: unknown;
  }[];

describe('views', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create and list', () => {
    it('creates a view with a null icon and empty filters and lists it', async () => {
      const { owner, teamId } = await setup();
      const v = await created(owner, { name: 'My issues', teamId });
      expect(v).toMatchObject({
        name: 'My issues',
        team: { id: teamId },
        icon: null,
        filterData: {},
      });
      expect((await list(owner)).map((x) => x.name)).toEqual(['My issues']);
    });

    it('stores the icon and filters verbatim', async () => {
      const { owner, teamId } = await setup();
      const filterData = { state: { type: { in: ['backlog'] } } };
      const v = await created(owner, { name: 'Backlog', teamId, icon: 'inbox', filterData });
      expect(v).toMatchObject({ icon: 'inbox', filterData });
    });

    it("lists views newest first, Linear's default order", async () => {
      const { owner, teamId } = await setup();
      const a = await created(owner, { name: 'A', teamId });
      const b = await created(owner, { name: 'B', teamId });
      const c = await created(owner, { name: 'C', teamId });
      expect((await list(owner)).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    });

    it('loads a stored view whose filter names removed fields', async () => {
      const { owner, teamId } = await setup();
      const filterData = {
        conditions: [
          { field: 'type', op: 'is', values: [crypto.randomUUID()] },
          { field: `cf:${crypto.randomUUID()}`, op: 'is_set', values: [] },
        ],
      };
      await createView(teamId, { name: 'Old', filterData }, owner.userId);
      expect((await list(owner))[0]).toMatchObject({ name: 'Old', filterData });
    });

    it('rejects an empty name', async () => {
      const { owner, teamId } = await setup();
      expect(code(await create(owner, { name: '', teamId }))).toBe('INVALID_INPUT');
    });

    it('refuses an unknown team', async () => {
      const { owner } = await setup();
      expect(code(await create(owner, { name: 'V', teamId: MISSING }))).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('keeps the filters when only the name changes', async () => {
      const { owner, teamId } = await setup();
      const filterData = { priority: { eq: 1 } };
      const v = await created(owner, { name: 'Original', teamId, filterData });
      expect(updated(await update(owner, v.id, { name: 'Renamed' }))).toMatchObject({
        name: 'Renamed',
        filterData,
      });
    });

    it('replaces the filters wholesale', async () => {
      const { owner, teamId } = await setup();
      const v = await created(owner, { name: 'V', teamId, filterData: { priority: { eq: 1 } } });
      const res = await update(owner, v.id, { filterData: { estimate: { eq: 3 } } });
      expect(updated(res)).toMatchObject({ name: 'V', filterData: { estimate: { eq: 3 } } });
    });

    it('sets and clears the icon', async () => {
      const { owner, teamId } = await setup();
      const v = await created(owner, { name: 'V', teamId, icon: 'star' });
      expect(updated(await update(owner, v.id, { icon: null })).icon).toBeNull();
      expect(updated(await update(owner, v.id, { icon: 'flag' })).icon).toBe('flag');
    });

    it('returns the current view for an empty update', async () => {
      const { owner, teamId } = await setup();
      const v = await created(owner, { name: 'V', teamId });
      expect(updated(await update(owner, v.id, {}))).toMatchObject({ id: v.id, name: 'V' });
    });

    it('answers not found for a missing view', async () => {
      const { owner } = await setup();
      expect(code(await update(owner, MISSING, { name: 'Nope' }))).toBe('ENTITY_NOT_FOUND');
    });

    it('rejects an empty name', async () => {
      const { owner, teamId } = await setup();
      const v = await created(owner, { name: 'V', teamId });
      expect(code(await update(owner, v.id, { name: '' }))).toBe('INVALID_INPUT');
    });
  });

  describe('delete and access', () => {
    it('answers not found when deleting a missing view', async () => {
      const { owner } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        `mutation ($id: String!) { customViewDelete(id: $id) { success } }`,
        { id: MISSING },
      );
      expect(code(res)).toBe('ENTITY_NOT_FOUND');
    });

    it('refuses to create a view in a team the user cannot see', async () => {
      const { teamId } = await setup();
      const guest = await signUpAs('guest');
      expect(code(await create(guest, { name: 'Intruder', teamId }))).toBe('ENTITY_NOT_FOUND');
    });
  });
});
