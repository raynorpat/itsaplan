import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import {
  createProject as createProjectAs,
  createTeam,
  createWebhook,
  gqlData,
} from '../../../__tests__/helpers/graphql';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, linearClient } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Project and ProjectUpdate events reach the webhooks of every team the project
// includes (one delivery per webhook), and never a team it does not include.

type Payload = {
  action: string;
  type: string;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
};

const TYPES = ['Project' as const, 'ProjectUpdate' as const];

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const ids: Record<string, string> = {};
  const hooks: Record<string, string> = {};
  for (const key of ['MKT', 'OPS', 'ENG']) {
    ids[key] = (await createTeam(owner, { key, name: key })).team.id;
    hooks[key] = (
      await createWebhook(owner, {
        url: `https://example.com/${key}`,
        resourceTypes: TYPES,
        teamId: key,
      })
    ).id;
  }
  return { owner, asOwner: owner, ids, hooks };
}

async function payloads(webhookId: string): Promise<Payload[]> {
  const res = await webhookDeliveries(webhookId);
  return res.data!.items.map((d) => d.payload as Payload).reverse();
}

async function createProject(u: TestUser, teamIds: string[], name = 'Launch') {
  return createProjectAs(u, { name, teamIds });
}

const run = (u: TestUser, mutation: string, vars: Record<string, unknown>) =>
  gqlData(u, mutation, vars);

describe('project webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sends one create to each team of the project and none to another team', async () => {
    const { asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!, ids.OPS!]);
    for (const key of ['MKT', 'OPS']) {
      const ps = await payloads(hooks[key]!);
      expect(ps).toHaveLength(1);
      expect(ps[0]).toMatchObject({
        action: 'create',
        type: 'Project',
        data: { id: project.id, name: 'Launch', teamIds: [ids.MKT, ids.OPS].sort() },
      });
    }
    expect(await payloads(hooks.ENG!)).toEqual([]);
  });

  it('sends an all-teams webhook one delivery for a two-team project', async () => {
    const { asOwner, ids } = await setup();
    const all = await createWebhook(asOwner, {
      url: 'https://example.com/all',
      resourceTypes: TYPES,
      allPublicTeams: true,
    });
    await createProject(asOwner, [ids.MKT!, ids.OPS!]);
    expect(await payloads(all.id)).toHaveLength(1);
  });

  it('sends a team change to the teams before and after it, then only to the remaining team', async () => {
    const { asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!, ids.OPS!]);
    await run(
      asOwner,
      `mutation ($id: String!, $t: [String!]) { projectUpdate(id: $id, input: { teamIds: $t }) { success } }`,
      { id: project.id, t: [ids.MKT!] },
    );
    const ops = await payloads(hooks.OPS!);
    expect(ops[1]).toMatchObject({
      action: 'update',
      data: { teamIds: [ids.MKT] },
      updatedFrom: { teamIds: [ids.MKT, ids.OPS].sort() },
    });
    await run(
      asOwner,
      `mutation ($id: String!) { projectUpdate(id: $id, input: { name: "Renamed" }) { success } }`,
      { id: project.id },
    );
    expect(await payloads(hooks.OPS!)).toHaveLength(2);
    const mkt = await payloads(hooks.MKT!);
    expect(mkt[mkt.length - 1]).toMatchObject({
      action: 'update',
      updatedFrom: { name: 'Launch' },
    });
  });

  it('sends Project remove to the teams it had', async () => {
    const { asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!, ids.OPS!]);
    await run(asOwner, `mutation ($id: String!) { projectDelete(id: $id) { success } }`, {
      id: project.id,
    });
    for (const key of ['MKT', 'OPS']) {
      const ps = await payloads(hooks[key]!);
      expect(ps[ps.length - 1]).toMatchObject({ action: 'remove', data: { id: project.id } });
    }
  });

  it('sends archive as a Project update with archivedAt', async () => {
    const { asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!]);
    await run(asOwner, `mutation ($id: String!) { projectArchive(id: $id) { success } }`, {
      id: project.id,
    });
    const [, archived] = await payloads(hooks.MKT!);
    expect(archived).toMatchObject({ action: 'update', updatedFrom: { archivedAt: null } });
    expect(archived!.data.archivedAt).toBeTruthy();
  });

  it('sends ProjectUpdate create, update and remove', async () => {
    const { owner, asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!]);
    const client = linearClient(await createApiKey(owner.cookie));
    const posted = await client.createProjectUpdate({
      projectId: project.id,
      body: 'Behind',
      health: 'atRisk' as never,
    });
    const update = (await posted.projectUpdate)!;
    await client.updateProjectUpdate(update.id, { body: 'Catching up' });
    await client.deleteProjectUpdate(update.id);
    const ps = (await payloads(hooks.MKT!)).filter((p) => p.type === 'ProjectUpdate');
    expect(ps.map((p) => p.action)).toEqual(['create', 'update', 'remove']);
    expect(ps[0]).toMatchObject({
      data: { id: update.id, projectId: project.id, health: 'atRisk', userId: owner.userId },
    });
    expect(ps[1]).toMatchObject({ updatedFrom: { body: 'Behind' } });
    expect(await payloads(hooks.ENG!)).toEqual([]);
  });

  it('sends one Project update for a GraphQL update that changes teams and fields', async () => {
    const { owner, asOwner, ids, hooks } = await setup();
    const project = await createProject(asOwner, [ids.MKT!]);
    const client = linearClient(await createApiKey(owner.cookie));
    await client.updateProject(project.id, { name: 'Renamed', teamIds: [ids.MKT!, ids.OPS!] });
    const updates = (await payloads(hooks.MKT!)).filter((p) => p.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.updatedFrom).toMatchObject({ name: 'Launch', teamIds: [ids.MKT] });
  });
});
