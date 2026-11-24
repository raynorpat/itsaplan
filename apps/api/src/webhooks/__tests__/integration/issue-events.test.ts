import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import {
  createIssue as createIssueAs,
  createLabel,
  createProject,
  createState,
  createTeam,
  createWebhook,
  gqlData,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { resetDb } from '../../../__tests__/helpers/db';
import { removeAttachmentEmbeds } from '../../../attachments/store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Issue events in Linear's webhook format, read back through the deliveries
// endpoint (the worker does not run in tests, so deliveries stay pending).

type Payload = {
  action: string;
  type: string;
  actor: { id: string; type: string; name: string } | null;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  url: string;
  organizationId: string;
  webhookId: string;
  createdAt: string;
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const team = {
    team: view.team,
    states: view.states.map((s) => ({ id: s.id, stateType: s.stateType })),
  };
  const hook = await createWebhook(owner, {
    url: 'https://example.com/hook',
    resourceTypes: ['Issue'],
    teamId: 'MKT',
  });
  return { owner, asOwner: owner, team, hookId: hook.id };
}

// Payloads of a webhook, oldest first.
async function payloads(webhookId: string): Promise<Payload[]> {
  const res = await webhookDeliveries(webhookId);
  return res.data!.items.map((d) => d.payload as Payload).reverse();
}

// Treaty revives ISO strings in the payload to Dates; compare as epoch ms.
const time = (v: unknown) => new Date(v as string).getTime();

async function createIssue(u: TestUser, stateId: string, title = 'Task', teamId = 'MKT') {
  return createIssueAs(u, { teamId, stateId, title });
}

const run = (u: TestUser, mutation: string, id: string) => gqlData(u, mutation, { id });
const archive = (u: TestUser, id: string) =>
  run(u, `mutation ($id: String!) { issueArchive(id: $id) { success } }`, id);
const restore = (u: TestUser, id: string) =>
  run(u, `mutation ($id: String!) { issueUnarchive(id: $id) { success } }`, id);

describe('issue webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sends Issue create with Linear data and the actor', async () => {
    const { owner, asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    const res = await webhookDeliveries(hookId);
    expect(res.data!.items).toHaveLength(1);
    expect(res.data!.items[0]!.eventType).toBe('Issue');
    const [p] = await payloads(hookId);
    expect(p).toMatchObject({
      action: 'create',
      type: 'Issue',
      actor: { id: owner.userId, type: 'user', name: 'Owner' },
      data: {
        id: issue.id,
        identifier: 'MKT-1',
        title: 'Task',
        teamId: team.team.id,
        stateId: team.states[0].id,
        labelIds: [],
        team: { id: team.team.id, key: 'MKT' },
        state: { id: team.states[0].id },
      },
      webhookId: hookId,
    });
    expect(p!.updatedFrom).toBeUndefined();
    expect(typeof p!.organizationId).toBe('string');
    expect(p!.url).toContain('/team/MKT/issue/1');
    expect(p!.data).not.toHaveProperty('assigneeUserId');
  });

  it('sends the old stateId in updatedFrom on a state change', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await updateIssue(asOwner, issue.id, { stateId: team.states[1].id });
    const [created, updated] = await payloads(hookId);
    expect(updated).toMatchObject({ action: 'update', data: { stateId: team.states[1].id } });
    expect(updated!.updatedFrom).toMatchObject({
      stateId: team.states[0].id,
      updatedAt: created!.data.updatedAt,
    });
    expect(updated!.updatedFrom).not.toHaveProperty('title');
  });

  it('sends the previous labelIds in updatedFrom on a label change', async () => {
    const { asOwner, team, hookId } = await setup();
    const a = await createLabel(asOwner, { name: 'a', teamId: 'MKT' });
    const b = await createLabel(asOwner, { name: 'b', teamId: 'MKT' });
    const issue = await createIssue(asOwner, team.states[0].id);
    await updateIssue(asOwner, issue.id, { labelIds: [a.id] });
    await updateIssue(asOwner, issue.id, { labelIds: [a.id, b.id] });
    const all = await payloads(hookId);
    const last = all[all.length - 1]!;
    expect(last.action).toBe('update');
    expect(last.updatedFrom).toMatchObject({ labelIds: [a.id] });
    expect(Object.keys(last.updatedFrom!).sort()).toEqual(['labelIds', 'updatedAt']);
    expect(last.data.labelIds).toEqual([a.id, b.id].sort());
  });

  it('sends archive and restore as Issue updates with archivedAt', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await archive(asOwner, issue.id);
    await restore(asOwner, issue.id);
    const [, archived, restored] = await payloads(hookId);
    expect(archived).toMatchObject({ action: 'update', updatedFrom: { archivedAt: null } });
    expect(archived!.data.archivedAt).toBeTruthy();
    expect(restored!.data.archivedAt).toBeNull();
    expect(restored!.updatedFrom!.archivedAt).toBeTruthy();
  });

  it('sends Issue remove with the data before deletion', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await run(asOwner, `mutation ($id: String!) { issueDelete(id: $id) { success } }`, issue.id);
    const all = await payloads(hookId);
    expect(all[all.length - 1]).toMatchObject({
      action: 'remove',
      data: { id: issue.id, identifier: 'MKT-1', title: 'Task' },
    });
  });

  it('sends one event per issue on a bulk update', async () => {
    const { asOwner, team, hookId } = await setup();
    const ids = [];
    for (const t of ['a', 'b', 'c'])
      ids.push((await createIssue(asOwner, team.states[0].id, t)).id);
    await gqlData(
      asOwner,
      `mutation ($ids: [UUID!]!) { issueBatchUpdate(ids: $ids, input: { priority: 2 }) { success } }`,
      { ids },
    );
    const updates = (await payloads(hookId)).filter((p) => p.action === 'update');
    expect(updates.map((p) => p.data.id).sort()).toEqual([...ids].sort());
  });

  it('sends events of a team created after an all-teams webhook', async () => {
    const { asOwner } = await setup();
    const all = await createWebhook(asOwner, {
      url: 'https://example.com/all',
      resourceTypes: ['Issue'],
      allPublicTeams: true,
    });
    const ops = await createTeam(asOwner, { key: 'OPS', name: 'Operations' });
    await createIssue(asOwner, ops.states[0]!.id, 'x', 'OPS');
    const [p] = await payloads(all.id);
    expect(p).toMatchObject({ action: 'create', data: { teamId: ops.team.id } });
  });

  it('sends nothing to a disabled webhook or one without Issue', async () => {
    const { asOwner, team } = await setup();
    const off = await createWebhook(asOwner, {
      url: 'https://example.com/a',
      resourceTypes: ['Issue'],
      enabled: false,
      teamId: 'MKT',
    });
    const other = await createWebhook(asOwner, {
      url: 'https://example.com/b',
      resourceTypes: ['Comment'],
      teamId: 'MKT',
    });
    await createIssue(asOwner, team.states[0].id);
    expect(await payloads(off.id)).toEqual([]);
    expect(await payloads(other.id)).toEqual([]);
  });

  it('bumps updatedAt on archive and restore', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await Bun.sleep(5);
    await archive(asOwner, issue.id);
    await Bun.sleep(5);
    await restore(asOwner, issue.id);
    const [, archived, restored] = await payloads(hookId);
    for (const p of [archived!, restored!])
      expect(time(p.data.updatedAt)).toBeGreaterThan(time(p.updatedFrom!.updatedAt));
  });

  it('sends one Issue update for a PATCH that changes fields and labels', async () => {
    const { asOwner, team, hookId } = await setup();
    const label = await createLabel(asOwner, { name: 'bug', teamId: 'MKT' });
    const issue = await createIssue(asOwner, team.states[0].id);
    await updateIssue(asOwner, issue.id, { title: 'Renamed', labelIds: [label.id] });
    const updates = (await payloads(hookId)).filter((p) => p.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.updatedFrom).toMatchObject({ title: 'Task', labelIds: [] });
  });

  it('sends one Issue update when a restore also moves the issue out of an archived state', async () => {
    const { asOwner, team, hookId } = await setup();
    const from = team.states.find((s) => s.stateType === 'started')!;
    // A second started state, so the issue's state can be archived.
    await createState(asOwner, { teamId: 'MKT', name: 'Review', type: 'started' });
    const issue = await createIssue(asOwner, from.id);
    await archive(asOwner, issue.id);
    await run(
      asOwner,
      `mutation ($id: String!) { workflowStateArchive(id: $id) { success } }`,
      from.id,
    );
    const before = (await payloads(hookId)).length;
    await restore(asOwner, issue.id);
    const after = (await payloads(hookId)).slice(before);
    expect(after).toHaveLength(1);
    expect(Object.keys(after[0]!.updatedFrom!)).toEqual(
      expect.arrayContaining(['archivedAt', 'stateId']),
    );
  });

  it('sends an Issue update when deleting an attachment strips its embed', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await updateIssue(asOwner, issue.id, {
      description: 'See ![shot](/attachments/abc123/raw) here',
    });
    const before = (await payloads(hookId)).length;
    await removeAttachmentEmbeds(issue.id, 'abc123');
    const after = (await payloads(hookId)).slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ action: 'update', data: { description: 'See  here' } });
  });

  it('keeps an issue’s events in its own team when it moves between projects', async () => {
    const { asOwner, team, hookId } = await setup();
    const ops = await createTeam(asOwner, { key: 'OPS', name: 'Operations' });
    const opsHook = await createWebhook(asOwner, {
      url: 'https://example.com/ops',
      resourceTypes: ['Issue'],
      teamId: 'OPS',
    });
    const shared = await createProject(asOwner, {
      name: 'Shared',
      teamIds: [team.team.id, ops.team.id],
    });
    const own = await createProject(asOwner, { name: 'Own', teamIds: [team.team.id] });
    const issue = await createIssue(asOwner, team.states[0].id);
    await updateIssue(asOwner, issue.id, { projectId: shared.id });
    await updateIssue(asOwner, issue.id, { projectId: own.id });
    expect(await payloads(opsHook.id)).toEqual([]);
    expect((await payloads(hookId)).filter((p) => p.action === 'update')).toHaveLength(2);
  });
});
