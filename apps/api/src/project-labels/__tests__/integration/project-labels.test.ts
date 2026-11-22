import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Workspace-level project labels (Linear's ProjectLabel): managed by any team
// member, applied to projects; a group holds labels and cannot be applied.

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  return { asOwner, teamId };
}

describe('project labels', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, lists, updates and deletes a label', async () => {
    const { asOwner } = await setup();
    const created = await asOwner['project-labels'].post({ name: 'Q3', color: '#ff0000' });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ name: 'Q3', color: '#ff0000', isGroup: false });

    const list = await asOwner['project-labels'].get();
    expect(list.data!.map((l) => l.name)).toEqual(['Q3']);

    const patched = await asOwner['project-labels']({ labelId: created.data!.id }).patch({
      name: 'Q4',
    });
    expect(patched.data).toMatchObject({ name: 'Q4' });

    const del = await asOwner['project-labels']({ labelId: created.data!.id }).delete();
    expect(del.status).toBe(204);
    expect((await asOwner['project-labels'].get()).data).toHaveLength(0);
  });

  it('rejects a duplicate name among siblings', async () => {
    const { asOwner } = await setup();
    await asOwner['project-labels'].post({ name: 'Q3' });
    expect((await asOwner['project-labels'].post({ name: 'Q3' })).status).toBe(409);
  });

  it('applies a label to a project and refuses a group', async () => {
    const { asOwner, teamId } = await setup();
    const group = (await asOwner['project-labels'].post({ name: 'Quarter', isGroup: true })).data!;
    const label = (await asOwner['project-labels'].post({ name: 'Q3', parentId: group.id })).data!;
    const ok = await asOwner.projects.post({ name: 'P', teamIds: [teamId], labelIds: [label.id] });
    expect(ok.data!.labelIds).toEqual([label.id]);
    const bad = await asOwner.projects.post({ name: 'G', teamIds: [teamId], labelIds: [group.id] });
    expect(bad.status).toBe(400);
  });

  it('refuses a user who is a member of no team', async () => {
    await setup();
    const loner = (await signUpWithRole('guest')).api;
    expect((await loner['project-labels'].post({ name: 'x' })).status).toBe(403);
  });
});
