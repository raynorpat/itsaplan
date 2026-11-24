import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createLabel,
  createTeam,
  gqlData,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Team labels and label groups over GraphQL: defaults, name rules, groups (a label
// joins a group through parentId; deleting a group ungroups its labels) and access.
// Workspace labels, retiring and labels on issues are in the GraphQL labels test.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setupTeam() {
  const owner = await signUpTestUser();
  const { team } = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: team.id };
}

const create = (who: TestUser, input: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { issueLabelCreate(input: ${input}) { success issueLabel { id name color parent { id } } } }`,
  );
const update = (who: TestUser, id: string, input: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { issueLabelUpdate(id: "${id}", input: ${input}) { success issueLabel { name color parent { id } } } }`,
  );
const remove = (who: TestUser, id: string) =>
  gql({ cookie: who.cookie }, `mutation { issueLabelDelete(id: "${id}") { success } }`);
const labelsOf = async (who: TestUser, key = 'MKT') => (await teamView(who, key)).labels;

describe('team labels and groups', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a label with the default colour and no group', async () => {
    const { owner, teamId } = await setupTeam();
    const res = await create(owner, `{ teamId: "${teamId}", name: "urgent" }`);
    expect(res.body.data).toMatchObject({
      issueLabelCreate: { issueLabel: { name: 'urgent', color: '#6b7280', parent: null } },
    });
    expect((await labelsOf(owner)).map((l) => l.name)).toEqual(['urgent']);
  });

  it('rejects an empty name and a duplicate name within the team, allows it in another team', async () => {
    const { owner, teamId } = await setupTeam();
    expect(code(await create(owner, `{ teamId: "${teamId}", name: "" }`))).toBe('INVALID_INPUT');
    await createLabel(owner, { teamId, name: 'urgent' });
    expect(code(await create(owner, `{ teamId: "${teamId}", name: "urgent" }`))).toBe('CONFLICT');
    const ops = (await createTeam(owner, { key: 'OPS', name: 'Ops' })).team.id;
    expect(
      (await create(owner, `{ teamId: "${ops}", name: "urgent" }`)).body.errors,
    ).toBeUndefined();
  });

  it("updates the name and colour; rejects an empty name and another label's name", async () => {
    const { owner, teamId } = await setupTeam();
    const a = await createLabel(owner, { teamId, name: 'urgent' });
    await createLabel(owner, { teamId, name: 'later' });
    const res = await update(owner, a.id, '{ name: "critical", color: "#ff0000" }');
    expect(res.body.data).toMatchObject({
      issueLabelUpdate: { issueLabel: { name: 'critical', color: '#ff0000' } },
    });
    expect(code(await update(owner, a.id, '{ name: "" }'))).toBe('INVALID_INPUT');
    expect(code(await update(owner, a.id, '{ name: "later" }'))).toBe('CONFLICT');
    expect((await labelsOf(owner)).map((l) => l.name).sort()).toEqual(['critical', 'later']);
  });

  it('puts a label in a group and takes it out; deleting the group ungroups its labels', async () => {
    const { owner, teamId } = await setupTeam();
    const group = await createLabel(owner, { teamId, name: 'severity', isGroup: true });
    expect(
      code(await create(owner, `{ teamId: "${teamId}", name: "severity", isGroup: true }`)),
    ).toBe('CONFLICT');
    const label = await createLabel(owner, { teamId, name: 'urgent', parentId: group.id });
    expect((await labelsOf(owner)).find((l) => l.id === label.id)?.parentId).toBe(group.id);
    await update(owner, label.id, '{ parentId: null }');
    expect((await labelsOf(owner)).find((l) => l.id === label.id)?.parentId).toBeNull();
    await update(owner, label.id, `{ parentId: "${group.id}" }`);
    expect((await remove(owner, group.id)).body.errors).toBeUndefined();
    const left = await labelsOf(owner);
    expect(left.map((l) => l.id)).not.toContain(group.id);
    expect(left.find((l) => l.id === label.id)?.parentId).toBeNull();
  });

  it('answers a missing label with ENTITY_NOT_FOUND', async () => {
    const { owner } = await setupTeam();
    const missing = crypto.randomUUID();
    expect(code(await update(owner, missing, '{ name: "x" }'))).toBe('ENTITY_NOT_FOUND');
    expect(code(await remove(owner, missing))).toBe('ENTITY_NOT_FOUND');
  });

  it('keeps a guest outside the team and a non-manager off its labels', async () => {
    const { owner, teamId } = await setupTeam();
    const label = await createLabel(owner, { teamId, name: 'urgent' });
    const guest = await signUpAs('guest');
    expect(code(await create(guest, `{ teamId: "${teamId}", name: "x" }`))).toBe(
      'ENTITY_NOT_FOUND',
    );
    expect(code(await update(guest, label.id, '{ name: "x" }'))).toBe('ENTITY_NOT_FOUND');
    expect(code(await remove(guest, label.id))).toBe('ENTITY_NOT_FOUND');
    const member = await signUpAs('member');
    await createTeam(member, { key: 'OPS', name: 'Ops' });
    expect(code(await update(member, label.id, '{ name: "x" }'))).toBe('FORBIDDEN');
    expect(code(await remove(member, label.id))).toBe('FORBIDDEN');
    expect(
      (await gqlData(owner, `{ issueLabel(id: "${label.id}") { name } }`)).issueLabel.name,
    ).toBe('urgent');
  });
});
