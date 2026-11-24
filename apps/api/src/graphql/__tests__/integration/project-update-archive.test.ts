import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { createTeam, teamView } from '../../../__tests__/helpers/graphql';

// Archiving a project update (Linear's projectUpdateArchive / Unarchive): an archived
// update leaves the project's updates unless includeArchived, the project's health
// comes from its latest unarchived update, and unarchive restores both.

type Project = {
  health: string | null;
  projectUpdates: { nodes: { id: string; archivedAt: string | null }[] };
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const teamId = (await teamView(owner, 'MKT')).team.id;
  const run = (query: string) => gql({ cookie: owner.cookie }, query);
  const created = await run(
    `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"] }) { project { id } } }`,
  );
  const projectId = (created.body.data as { projectCreate: { project: { id: string } } })
    .projectCreate.project.id;
  const post = async (health: string) => {
    const res = await run(
      `mutation { projectUpdateCreate(input: { projectId: "${projectId}", body: "b", health: ${health} }) { projectUpdate { id } } }`,
    );
    return (res.body.data as { projectUpdateCreate: { projectUpdate: { id: string } } })
      .projectUpdateCreate.projectUpdate.id;
  };
  const read = async (includeArchived = false) => {
    const res = await run(
      `{ project(id: "${projectId}") { health projectUpdates(includeArchived: ${includeArchived}) { nodes { id archivedAt } } } }`,
    );
    expect(res.body.errors).toBeUndefined();
    return (res.body.data as { project: Project }).project;
  };
  return { run, post, read };
}

describe('graphql project update archive', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('hides an archived update and takes the health from the latest unarchived one', async () => {
    const { run, post, read } = await setup();
    const first = await post('onTrack');
    const second = await post('offTrack');
    expect((await read()).health).toBe('offTrack');

    const archived = await run(
      `mutation { projectUpdateArchive(id: "${second}") { success entity { id archivedAt } } }`,
    );
    expect(archived.body.errors).toBeUndefined();
    const entity = (
      archived.body.data as { projectUpdateArchive: { entity: { archivedAt: string | null } } }
    ).projectUpdateArchive.entity;
    expect(entity.archivedAt).not.toBeNull();

    const after = await read();
    expect(after.health).toBe('onTrack');
    expect(after.projectUpdates.nodes.map((n) => n.id)).toEqual([first]);
    expect((await read(true)).projectUpdates.nodes.map((n) => n.id).sort()).toEqual(
      [first, second].sort(),
    );

    const restored = await run(`mutation { projectUpdateUnarchive(id: "${second}") { success } }`);
    expect(restored.body.errors).toBeUndefined();
    const back = await read();
    expect(back.health).toBe('offTrack');
    expect(back.projectUpdates.nodes.map((n) => n.id)).toEqual([second, first]);
  });
});
