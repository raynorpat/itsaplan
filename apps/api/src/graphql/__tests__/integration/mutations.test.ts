import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import {
  createTeam,
  createWebhook,
  gqlData,
  signUpAs,
  statesByType,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Issue and workflow state mutations over the Linear API: their activity, webhooks
// and permissions.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const col = statesByType(await teamView(owner, 'MKT'));
  const client = linearClient(await createApiKey(owner.cookie));
  const team = await client.team('MKT');
  return { owner, col, client, teamId: team.id };
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql mutations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('issueCreate', () => {
    it('creates an issue with an identifier in the default backlog state', async () => {
      const { client, teamId, col } = await setup();
      const payload = await client.createIssue({ teamId, title: 'From the SDK' });
      expect(payload.success).toBe(true);
      expect(payload.lastSyncId).toBeGreaterThan(0);
      const issue = (await payload.issue)!;
      expect(issue.identifier).toBe('MKT-1');
      expect((await issue.state)?.id).toBe(col.backlog);
    });

    it('honours the supported input fields', async () => {
      const { owner, client, teamId, col } = await setup();
      await client.updateTeam(teamId, { issueEstimationType: 'fibonacci' });
      const parent = (await (await client.createIssue({ teamId, title: 'Parent' })).issue)!;
      const issue = (await (
        await client.createIssue({
          teamId,
          title: 'Child',
          description: 'body',
          priority: 1,
          estimate: 5,
          dueDate: '2026-12-24',
          assigneeId: owner.userId,
          parentId: parent.id,
          stateId: col.started,
        })
      ).issue)!;
      expect(issue).toMatchObject({ description: 'body', priority: 1, estimate: 5 });
      expect((await issue.assignee)?.id).toBe(owner.userId);
      expect((await issue.parent)?.id).toBe(parent.id);
      expect(issue.startedAt).toBeTruthy();
    });

    it('accepts the team key as teamId', async () => {
      const { client } = await setup();
      const payload = await client.createIssue({ teamId: 'MKT', title: 'By key' });
      expect((await payload.issue)?.identifier).toBe('MKT-1');
    });

    it('rejects a state from another team', async () => {
      const { owner, teamId } = await setup();
      const other = await signUpTestUser();
      const opsState = (await createTeam(other, { key: 'OPS', name: 'Operations' })).states[0]!.id;
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { issueCreate(input: { teamId: "${teamId}", title: "x", stateId: "${opsState}" }) { success } }`,
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
    });

    it('rejects an input field that is not supported, naming it', async () => {
      const { owner, teamId } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { issueCreate(input: { teamId: "${teamId}", title: "x", templateId: "x" }) { success } }`,
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
      expect(res.body.errors?.[0].message).toContain('templateId');
    });

    it('denies a guest outside the team', async () => {
      const { teamId } = await setup();
      const member = await signUpAs('guest');
      const res = await gql(
        { cookie: member.cookie },
        `mutation { issueCreate(input: { teamId: "${teamId}", title: "x" }) { success } }`,
      );
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('issueUpdate', () => {
    it('moves an issue and records its activity and webhook', async () => {
      const { owner, client, teamId, col } = await setup();
      const hook = await createWebhook(owner, {
        teamId: 'MKT',
        url: 'https://example.com/hook',
        resourceTypes: ['Issue'],
      });
      const issue = (await (await client.createIssue({ teamId, title: 'Move me' })).issue)!;

      const payload = await client.updateIssue(issue.id, { stateId: col.completed });
      const updated = (await payload.issue)!;
      expect(updated.completedAt).toBeTruthy();

      const history = await gqlData(
        owner,
        `query ($id: String!) { issue(id: $id) { history { nodes { toState { id } } } } }`,
        { id: issue.id },
      );
      expect(
        history.issue.history.nodes.map((h: { toState: { id: string } | null }) => h.toState?.id),
      ).toContain(col.completed);
      const deliveries = await webhookDeliveries(hook.id);
      const moved = deliveries.data!.items.find(
        (d) => (d.payload as { action: string }).action === 'update',
      );
      expect(
        (moved!.payload as { updatedFrom: Record<string, unknown> }).updatedFrom,
      ).toHaveProperty('stateId');
    });

    it('denies a guest outside the team', async () => {
      const { client, teamId } = await setup();
      const issue = (await (await client.createIssue({ teamId, title: 'x' })).issue)!;
      const member = await signUpAs('guest');
      const res = await gql(
        { cookie: member.cookie },
        `mutation { issueUpdate(id: "${issue.id}", input: { title: "y" }) { success } }`,
      );
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });

    it('answers ENTITY_NOT_FOUND for an issue the viewer cannot see', async () => {
      const { owner } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        'mutation { issueUpdate(id: "00000000-0000-4000-8000-000000000000", input: { title: "y" }) { success } }',
      );
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('issueBatchUpdate', () => {
    it('updates several issues', async () => {
      const { client, teamId } = await setup();
      const a = (await (await client.createIssue({ teamId, title: 'a' })).issue)!;
      const b = (await (await client.createIssue({ teamId, title: 'b' })).issue)!;
      const payload = await client.updateIssueBatch([a.id, b.id], { priority: 3 });
      expect(payload.success).toBe(true);
      expect((await client.issue(a.id)).priority).toBe(3);
      expect((await client.issue(b.id)).priority).toBe(3);
    });

    it('changes nothing when one issue is not visible', async () => {
      const { owner, client, teamId } = await setup();
      const a = (await (await client.createIssue({ teamId, title: 'a' })).issue)!;
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { issueBatchUpdate(ids: ["${a.id}", "00000000-0000-4000-8000-000000000000"], input: { priority: 1 }) { success } }`,
      );
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
      expect((await client.issue(a.id)).priority).toBe(0);
    });
  });

  describe('archive and delete', () => {
    it('archives and unarchives an issue', async () => {
      const { client, teamId } = await setup();
      const issue = (await (await client.createIssue({ teamId, title: 'x' })).issue)!;
      const archived = await client.archiveIssue(issue.id);
      expect(archived.success).toBe(true);
      expect((await client.issue(issue.id)).archivedAt).toBeTruthy();
      await client.unarchiveIssue(issue.id);
      expect((await client.issue(issue.id)).archivedAt).toBeFalsy();
    });

    it('deletes an issue', async () => {
      const { owner, client, teamId } = await setup();
      const issue = (await (await client.createIssue({ teamId, title: 'x' })).issue)!;
      const deleted = await client.deleteIssue(issue.id);
      expect(deleted.success).toBe(true);
      const res = await gql({ cookie: owner.cookie }, `{ issue(id: "${issue.id}") { id } }`);
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('workflow states', () => {
    it('creates and updates a state', async () => {
      const { client, teamId } = await setup();
      const created = await client.createWorkflowState({
        teamId,
        name: 'Review',
        type: 'started',
        color: '#ff0000',
      });
      const state = await created.workflowState;
      expect(state).toMatchObject({ name: 'Review', type: 'started', color: '#ff0000' });
      const updated = await client.updateWorkflowState(state!.id, { name: 'Code review' });
      expect((await updated.workflowState)?.name).toBe('Code review');
    });

    it('rejects the reserved triage type', async () => {
      const { owner, teamId } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "T", type: "triage", color: "#000" }) { success } }`,
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
    });

    it('archives an empty state and refuses the last state of its type', async () => {
      const { owner, client, teamId, col } = await setup();
      const review = (await (
        await client.createWorkflowState({ teamId, name: 'Review', type: 'started', color: '#111' })
      ).workflowState)!;
      const archived = await client.archiveWorkflowState(review.id);
      expect(archived.success).toBe(true);

      const res = await gql(
        { cookie: owner.cookie },
        `mutation { workflowStateArchive(id: "${col.completed}") { success } }`,
      );
      expect(errorCode(res)).toBe('CONFLICT');
    });
  });
});
