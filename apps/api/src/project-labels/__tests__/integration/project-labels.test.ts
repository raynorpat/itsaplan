import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Workspace-level project labels (Linear's ProjectLabel): managed by any team
// member, applied to projects; a group holds labels and cannot be applied.

const code = (res: Awaited<ReturnType<typeof gql>>) => res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id };
}

function createLabel(u: TestUser, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($input: ProjectLabelCreateInput!) {
      projectLabelCreate(input: $input) { projectLabel { id name color isGroup } } }`,
    { input },
  );
}

const labelOf = (res: Awaited<ReturnType<typeof gql>>) =>
  (res.body.data as { projectLabelCreate: { projectLabel: { id: string } } }).projectLabelCreate
    .projectLabel;

const names = async (u: TestUser) =>
  (await gqlData(u, '{ projectLabels { nodes { name } } }')).projectLabels.nodes.map(
    (l: { name: string }) => l.name,
  );

describe('project labels', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, lists, updates and deletes a label', async () => {
    const { owner } = await setup();
    const created = await createLabel(owner, { name: 'Q3', color: '#ff0000' });
    expect(created.body.errors).toBeUndefined();
    expect(labelOf(created)).toMatchObject({ name: 'Q3', color: '#ff0000', isGroup: false });
    expect(await names(owner)).toEqual(['Q3']);
    const patched = await gqlData(
      owner,
      `mutation ($id: String!) { projectLabelUpdate(id: $id, input: { name: "Q4" }) {
        projectLabel { name } } }`,
      { id: labelOf(created).id },
    );
    expect(patched.projectLabelUpdate.projectLabel.name).toBe('Q4');
    await gqlData(owner, `mutation ($id: String!) { projectLabelDelete(id: $id) { success } }`, {
      id: labelOf(created).id,
    });
    expect(await names(owner)).toHaveLength(0);
  });

  it('rejects a duplicate name among siblings', async () => {
    const { owner } = await setup();
    await createLabel(owner, { name: 'Q3' });
    expect(code(await createLabel(owner, { name: 'Q3' }))).toBe('CONFLICT');
  });

  it('applies a label to a project and refuses a group', async () => {
    const { owner, teamId } = await setup();
    const group = labelOf(await createLabel(owner, { name: 'Quarter', isGroup: true }));
    const label = labelOf(await createLabel(owner, { name: 'Q3', parentId: group.id }));
    const create = (labelIds: string[]) =>
      gql(
        { cookie: owner.cookie },
        `mutation ($input: ProjectCreateInput!) {
          projectCreate(input: $input) { project { labelIds } } }`,
        { input: { name: 'P', teamIds: [teamId], labelIds } },
      );
    const ok = await create([label.id]);
    expect(
      (ok.body.data as { projectCreate: { project: { labelIds: string[] } } }).projectCreate.project
        .labelIds,
    ).toEqual([label.id]);
    expect(code(await create([group.id]))).toBe('INVALID_INPUT');
  });

  it('refuses a user who is a member of no team', async () => {
    await setup();
    const loner = await signUpAs('guest');
    expect(code(await createLabel(loner, { name: 'x' }))).toBe('FORBIDDEN');
  });
});
