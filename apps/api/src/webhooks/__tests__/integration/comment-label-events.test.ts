import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import {
  createComment,
  createIssue,
  createLabel,
  createTeam,
  createWebhook,
  gqlData,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { resetDb } from '../../../__tests__/helpers/db';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Comment and IssueLabel events. Team label groups are sent as IssueLabels with
// isGroup: true, as Linear models them.

type Payload = {
  action: string;
  type: string;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const hook = await createWebhook(owner, {
    url: 'https://example.com/hook',
    resourceTypes: ['Comment', 'IssueLabel'],
    teamId: 'MKT',
  });
  const stateId = view.states[0]!.id;
  const newIssue = () => createIssue(owner, { teamId: view.team.id, stateId, title: 'x' });
  const label = (input: { name: string; color?: string; isGroup?: boolean; parentId?: string }) =>
    createLabel(owner, { teamId: view.team.id, ...input });
  return { owner, hookId: hook.id, newIssue, label };
}

const mutate = (owner: { cookie: string }, query: string, id: string) =>
  gqlData(owner, query, { id });

async function payloads(webhookId: string): Promise<Payload[]> {
  const res = await webhookDeliveries(webhookId);
  return res.data!.items.map((d) => d.payload as Payload).reverse();
}

describe('comment and label webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sends Comment create', async () => {
    const { owner, hookId, newIssue } = await setup();
    const issue = await newIssue();
    await createComment(owner, { issueId: issue.id, body: 'hi' });
    const [p] = await payloads(hookId);
    expect(p).toMatchObject({
      action: 'create',
      type: 'Comment',
      data: { body: 'hi', issueId: issue.id, userId: owner.userId },
    });
    expect(typeof p!.data.id).toBe('string');
  });

  it('sends IssueLabel create, update and remove', async () => {
    const { owner, hookId, label } = await setup();
    const created = await label({ name: 'bug', color: '#ff0000' });
    await Bun.sleep(5);
    await mutate(
      owner,
      `mutation ($id: String!) { issueLabelUpdate(id: $id, input: { name: "defect" }) { success } }`,
      created.id,
    );
    await mutate(
      owner,
      `mutation ($id: String!) { issueLabelDelete(id: $id) { success } }`,
      created.id,
    );
    const [c, u, r] = await payloads(hookId);
    expect(c).toMatchObject({
      action: 'create',
      type: 'IssueLabel',
      data: { id: created.id, name: 'bug', color: '#ff0000', isGroup: false, parentId: null },
    });
    expect(u).toMatchObject({
      action: 'update',
      data: { name: 'defect' },
      updatedFrom: { name: 'bug' },
    });
    expect(new Date(u!.data.updatedAt as string).getTime()).toBeGreaterThan(
      new Date(u!.updatedFrom!.updatedAt as string).getTime(),
    );
    expect(r).toMatchObject({ action: 'remove', data: { id: created.id, name: 'defect' } });
  });

  it('sends a label group as an IssueLabel with isGroup', async () => {
    const { hookId, label } = await setup();
    const group = await label({ name: 'Area', isGroup: true });
    const inGroup = await label({ name: 'api', parentId: group.id });
    const [g, l] = await payloads(hookId);
    expect(g).toMatchObject({
      action: 'create',
      data: { id: group.id, name: 'Area', isGroup: true },
    });
    expect(l).toMatchObject({ data: { id: inGroup.id, parentId: group.id } });
  });

  it('deleting a group sends an update for each label it held, then the group remove', async () => {
    const { owner, hookId, label } = await setup();
    const group = await label({ name: 'Area', isGroup: true });
    const a = await label({ name: 'a', parentId: group.id });
    const b = await label({ name: 'b', parentId: group.id });
    await mutate(
      owner,
      `mutation ($id: String!) { issueLabelDelete(id: $id) { success } }`,
      group.id,
    );
    const after = (await payloads(hookId)).slice(3);
    const updates = after.filter((p) => p.action === 'update');
    expect(updates.map((p) => p.data.id).sort()).toEqual([a.id, b.id].sort());
    for (const p of updates) expect(p.updatedFrom).toMatchObject({ parentId: group.id });
    expect(after[after.length - 1]).toMatchObject({ action: 'remove', data: { id: group.id } });
  });

  it('does not send IssueLabel events when an issue’s labels change', async () => {
    const { owner, hookId, newIssue, label } = await setup();
    const l = await label({ name: 'bug' });
    const issue = await newIssue();
    await updateIssue(owner, issue.id, { labelIds: [l.id] });
    expect((await payloads(hookId)).map((p) => p.action)).toEqual(['create']);
  });
});
