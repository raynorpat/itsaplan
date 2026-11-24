import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Teams over GraphQL: teamCreate (key rules, seeded states), the teams list,
// teamUpdate, team(id), teamDelete and the auto-archive setting. Visibility by role
// is in shared/__tests__/integration/roles.test.ts.

const DEFAULT_STATE_NAMES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const create = (who: TestUser, input: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { teamCreate(input: ${input}) { success team { id key name description } } }`,
  );
const teamKeys = async (who: TestUser) =>
  (await gqlData(who, '{ teams { nodes { key } } }')).teams.nodes.map(
    (t: { key: string }) => t.key,
  );

describe('teams', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('stores the key uppercased and seeds the five default states', async () => {
      const owner = await signUpTestUser();
      const res = await create(owner, '{ key: "ops", name: "Operations" }');
      expect(res.body.errors).toBeUndefined();
      expect((res.body.data as { teamCreate: { team: { key: string } } }).teamCreate.team.key).toBe(
        'OPS',
      );
      expect((await teamView(owner, 'OPS')).states.map((s) => s.name)).toEqual(DEFAULT_STATE_NAMES);
    });

    it('stores the name and description and makes the creator a team owner', async () => {
      const owner = await signUpTestUser();
      const res = await create(
        owner,
        '{ key: "MKT", name: "Marketing", description: "Growth work" }',
      );
      expect(res.body.data).toMatchObject({
        teamCreate: { team: { key: 'MKT', name: 'Marketing', description: 'Growth work' } },
      });
      expect((await teamView(owner, 'MKT')).members).toEqual([
        { id: expect.any(String), owner: true, userId: owner.userId },
      ]);
    });

    it('rejects a malformed or empty key and an empty name', async () => {
      const owner = await signUpTestUser();
      for (const key of ['A-B', '1AB', 'A B', ''])
        expect(code(await create(owner, `{ key: "${key}", name: "X" }`))).toBe('INVALID_INPUT');
      expect(code(await create(owner, '{ key: "MKT", name: "" }'))).toBe('INVALID_INPUT');
      expect(await teamKeys(owner)).toEqual([]);
    });

    it('rejects a duplicate key with CONFLICT', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      expect(code(await create(owner, '{ key: "MKT", name: "Marketing Two" }'))).toBe('CONFLICT');
    });
  });

  describe('list', () => {
    it('lists the teams ordered by key', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'OPS', name: 'Operations' });
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      expect(await teamKeys(owner)).toEqual(['MKT', 'OPS']);
    });

    it('lists public teams a member has not joined, without management', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const other = await signUpAs('member');
      expect(await teamKeys(other)).toEqual(['MKT']);
      expect((await teamView(other, 'MKT')).members.map((m) => m.userId)).not.toContain(
        other.userId,
      );
      const rename = await gql(
        { cookie: other.cookie },
        'mutation { teamUpdate(id: "MKT", input: { name: "Hijacked" }) { success } }',
      );
      expect(code(rename)).toBe('FORBIDDEN');
    });

    it('does not show a team to a guest outside it', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      expect(await teamKeys(await signUpAs('guest'))).toEqual([]);
    });
  });

  describe('update and read', () => {
    it("updates an owner's team name and description, leaving the key", async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const res = await gql(
        { cookie: owner.cookie },
        'mutation { teamUpdate(id: "MKT", input: { name: "Growth", description: "Growth work" }) { success } }',
      );
      expect(res.body.errors).toBeUndefined();
      const team = await gqlData(owner, '{ team(id: "MKT") { key name description } }');
      expect(team.team).toEqual({ key: 'MKT', name: 'Growth', description: 'Growth work' });
    });

    it('answers an unknown team, or one a guest is not in, with ENTITY_NOT_FOUND', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      expect(code(await gql({ cookie: owner.cookie }, '{ team(id: "NOPE") { id } }'))).toBe(
        'ENTITY_NOT_FOUND',
      );
      const guest = await signUpAs('guest');
      expect(code(await gql({ cookie: guest.cookie }, '{ team(id: "MKT") { id } }'))).toBe(
        'ENTITY_NOT_FOUND',
      );
    });
  });

  describe('delete', () => {
    it('deletes a team and its issues for an owner', async () => {
      const owner = await signUpTestUser();
      const { team } = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const issue = await createIssue(owner, { teamId: team.id, title: 'Task' });
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { teamDelete(id: "${team.id}") { success } }`,
      );
      expect(res.body.errors).toBeUndefined();
      expect(await teamKeys(owner)).toEqual([]);
      expect(code(await gql({ cookie: owner.cookie }, `{ issue(id: "${issue.id}") { id } }`))).toBe(
        'ENTITY_NOT_FOUND',
      );
    });

    it('refuses an unknown team, a guest and a member who does not manage it', async () => {
      const owner = await signUpTestUser();
      const { team } = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const del = (who: TestUser, id: string) =>
        gql({ cookie: who.cookie }, `mutation { teamDelete(id: "${id}") { success } }`);
      expect(code(await del(owner, crypto.randomUUID()))).toBe('ENTITY_NOT_FOUND');
      expect(code(await del(await signUpAs('guest'), team.id))).toBe('ENTITY_NOT_FOUND');
      expect(code(await del(await signUpAs('member'), team.id))).toBe('FORBIDDEN');
      expect(await teamKeys(owner)).toEqual(['MKT']);
    });
  });

  describe('auto-archive', () => {
    it("defaults a new team to Linear's six-month period, turns off with 0 and refuses other values", async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const period = async () =>
        (await gqlData(owner, '{ team(id: "MKT") { autoArchivePeriod } }')).team.autoArchivePeriod;
      expect(await period()).toBe(6);
      const set = (value: number) =>
        gql(
          { cookie: owner.cookie },
          `mutation { teamUpdate(id: "MKT", input: { autoArchivePeriod: ${value} }) { success } }`,
        );
      expect((await set(0)).body.errors).toBeUndefined();
      expect(await period()).toBe(0);
      expect(code(await set(2))).toBe('INVALID_INPUT');
      expect(await period()).toBe(0);
    });

    it('refuses the setting to a member who does not manage the team', async () => {
      const owner = await signUpTestUser();
      await createTeam(owner, { key: 'MKT', name: 'Marketing' });
      const member = await signUpAs('member');
      const res = await gql(
        { cookie: member.cookie },
        'mutation { teamUpdate(id: "MKT", input: { autoArchivePeriod: 3 }) { success } }',
      );
      expect(code(res)).toBe('FORBIDDEN');
    });
  });
});
