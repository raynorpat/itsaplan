import { beforeEach, describe, expect, it } from 'bun:test';
import { db, webhookDelivery, workflowDefinition } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createLabel,
  createTeam,
  createWebhook,
  gqlData,
  signUpAs,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { bearer, createClient, install, ORIGIN } from '../../../__tests__/helpers/oauth';
import { countStatements } from '../../../__tests__/helpers/statements';

// The run engine of the team automation rules: when a rule runs, what it changes, and
// how its changes are attributed to the workflow.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function plugin(as: TestUser, path: string, body?: Json): Promise<Json> {
  const res = await app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: ORIGIN,
        cookie: as.cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const createRule = async (as: TestUser, body: Json) =>
  (await plugin(as, 'workflows/create', body)).workflow as Json;

// The rule as the plugin returns it, read as the workspace owner.
let reader: TestUser;
const ruleRow = async (id: string) => (await plugin(reader, `workflow?id=${id}`)).workflow as Json;

async function issueDetail(as: TestUser, id: string): Promise<Json> {
  const data = await gqlData(
    as,
    `query ($id: String!) { issue(id: $id) {
      priority state { id } assignee { id } delegate { id }
      labels { nodes { id } }
      history { nodes { actor { id } botActor { type id name } fromPriority toPriority } }
      comments { nodes { body user { id } botActor { type id name } } }
    } }`,
    { id },
  );
  return data.issue;
}

interface Setup {
  owner: TestUser; // workspace owner, team owner of ENG, and the rules' owner
  member: TestUser;
  teamId: string;
  states: Record<string, string>;
}

async function setup(): Promise<Setup> {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const member = await signUpAs('member', { name: 'Ann' });
  await addMember(owner, eng.team.id, member.userId);
  reader = owner;
  return { owner, member, teamId: eng.team.id, states: statesByType(eng) };
}

beforeEach(async () => {
  await resetDb();
});

describe('workflow runs', () => {
  it('runs a created rule on a new issue that matches, attributed to the workflow', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Start urgent issues',
      trigger: 'entityCreated',
      conditions: { priority: { eq: 1 } },
      activities: [{ type: 'setState', stateId: s.states.started }],
    });
    const matching = await createIssue(s.member, { teamId: s.teamId, priority: 1 });
    const other = await createIssue(s.member, { teamId: s.teamId, priority: 3 });

    // The issue the client reads back already carries the workflow's change.
    expect(matching.stateId).toBe(s.states.started);
    expect(other.stateId).not.toBe(s.states.started);

    const detail = await issueDetail(s.owner, matching.id);
    const byWorkflow = detail.history.nodes.filter((h: Json) => h.botActor);
    expect(byWorkflow.length).toBeGreaterThan(0);
    for (const h of byWorkflow) {
      expect(h.actor).toBeNull();
      expect(h.botActor).toEqual({ type: 'workflow', id: rule.id, name: 'Start urgent issues' });
    }

    const row = await ruleRow(rule.id);
    expect(row.stats.runs).toBe(1);
    expect(row.lastExecutedAt).not.toBeNull();
  });

  it('runs an updated rule only when the issue starts matching', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Assign urgent',
      trigger: 'entityUpdated',
      activationMode: 'conditionsStartedMatching',
      conditions: { priority: { eq: 1 } },
      activities: [{ type: 'setAssignee', userId: s.member.userId }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 3 });
    await updateIssue(s.owner, issue.id, { priority: 1 });
    expect((await issueDetail(s.owner, issue.id)).assignee?.id).toBe(s.member.userId);

    // Still matching after another edit: the rule does not run again.
    await updateIssue(s.owner, issue.id, { assigneeId: null });
    await updateIssue(s.owner, issue.id, { title: 'Renamed' });
    expect((await issueDetail(s.owner, issue.id)).assignee).toBeNull();
    expect((await ruleRow(rule.id)).stats.runs).toBe(1);
  });

  it('applies rules in order, a later rule winning the same field', async () => {
    const s = await setup();
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Second',
      trigger: 'entityCreated',
      sortOrder: 2,
      activities: [{ type: 'setPriority', priority: 3 }],
    });
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'First',
      trigger: 'entityCreated',
      sortOrder: 1,
      activities: [{ type: 'setPriority', priority: 2 }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    expect((await issueDetail(s.owner, issue.id)).priority).toBe(3);
  });

  it("does not run rules off a workflow's own change", async () => {
    const s = await setup();
    const label = await createLabel(s.owner, { name: 'triaged', teamId: s.teamId });
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Label new',
      trigger: 'entityCreated',
      activities: [{ type: 'addLabels', labelIds: [label.id] }],
    });
    const follow = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Prioritise labelled',
      trigger: 'entityUpdated',
      activationMode: 'conditionsStartedMatching',
      conditions: { labels: { some: { id: { eq: label.id } } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    const detail = await issueDetail(s.owner, issue.id);
    expect(detail.labels.nodes.map((l: Json) => l.id)).toEqual([label.id]);
    expect(detail.priority).toBe(4);
    expect((await ruleRow(follow.id)).stats.runs).toBe(0);
  });

  it('does not run rules on a system update (the automatic cancel of a duplicate)', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Canceled',
      trigger: 'entityUpdated',
      activationMode: 'conditionsStartedMatching',
      conditions: { state: { type: { eq: 'canceled' } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const dup = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    const original = await createIssue(s.owner, { teamId: s.teamId });
    await gqlData(
      s.owner,
      `mutation ($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
      { input: { issueId: dup.id, relatedIssueId: original.id, type: 'duplicate' } },
    );
    expect((await issueDetail(s.owner, dup.id)).priority).toBe(4);
    expect((await ruleRow(rule.id)).stats.runs).toBe(0);
  });

  it('skips an action that no longer fits, records it and applies the rest', async () => {
    const s = await setup();
    const label = await createLabel(s.owner, { name: 'gone', teamId: s.teamId });
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Label and prioritise',
      trigger: 'entityCreated',
      activities: [
        { type: 'addLabels', labelIds: [label.id] },
        { type: 'setPriority', priority: 2 },
      ],
    });
    await gqlData(s.owner, `mutation ($id: String!) { issueLabelRetire(id: $id) { success } }`, {
      id: label.id,
    });
    const issue = await createIssue(s.member, { teamId: s.teamId, priority: 4 });
    const detail = await issueDetail(s.owner, issue.id);
    expect(detail.priority).toBe(2);
    expect(detail.labels.nodes).toEqual([]);
    const stats = (await ruleRow(rule.id)).stats;
    expect(stats.runs).toBe(1);
    expect(typeof stats.lastError).toBe('string');
  });

  it("sends the workflow's change as its own webhook event with the workflow as actor", async () => {
    const s = await setup();
    await createWebhook(s.owner, {
      url: 'https://hooks.example.com/in',
      resourceTypes: ['Issue'],
      teamId: s.teamId,
    });
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Prioritise',
      trigger: 'entityCreated',
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    await createIssue(s.member, { teamId: s.teamId, priority: 4 });
    const payloads = (await db.select().from(webhookDelivery)).map((d) => d.payload as Json);
    const create = payloads.find((p) => p.action === 'create');
    const update = payloads.find((p) => p.action === 'update');
    expect(create?.actor?.id).toBe(s.member.userId);
    expect(update?.actor).toEqual({ id: rule.id, type: 'workflow', name: 'Prioritise' });
    expect(update?.data?.priority).toBe(1);
  });

  it('posts a workflow comment with no author that subscribes no one', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Welcome',
      trigger: 'entityCreated',
      activities: [{ type: 'addComment', body: 'Thanks for the report.' }],
    });
    const issue = await createIssue(s.member, { teamId: s.teamId });
    const comments = (await issueDetail(s.owner, issue.id)).comments.nodes;
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Thanks for the report.');
    expect(comments[0].user).toBeNull();
    expect(comments[0].botActor).toEqual({ type: 'workflow', id: rule.id, name: 'Welcome' });
    const subscribers = await gqlData(
      s.owner,
      'query ($id: String!) { issue(id: $id) { subscribers { nodes { id } } } }',
      { id: issue.id },
    );
    // Only the creator, who Linear subscribes to a new issue; not the rule's owner.
    expect(subscribers.issue.subscribers.nodes.map((u: Json) => u.id)).toEqual([s.member.userId]);
  });

  it('notifies the person a workflow assigns, even when they made the change', async () => {
    const s = await setup();
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Assign to me',
      trigger: 'entityCreated',
      activities: [{ type: 'setAssignee', userId: s.member.userId }],
    });
    await createIssue(s.member, { teamId: s.teamId });
    const data = await gqlData(s.member, '{ notifications { nodes { type } } }');
    expect(data.notifications.nodes.map((n: Json) => n.type)).toContain('issueAssignedToYou');
  });

  it("delegates to an agent with the rule's owner as the session's creator", async () => {
    const s = await setup();
    const client = await createClient(s.owner.cookie);
    const tokens = await install(s.owner.cookie, client, { scope: 'read,write,app:assignable' });
    const appUserId = (await gqlData({ headers: bearer(tokens.access_token) }, '{ viewer { id } }'))
      .viewer.id as string;
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Hand to agent',
      trigger: 'entityCreated',
      activities: [{ type: 'setDelegate', appUserId }],
    });
    const issue = await createIssue(s.member, { teamId: s.teamId });
    expect((await issueDetail(s.owner, issue.id)).delegate?.id).toBe(appUserId);
    const sessions = (
      await gqlData(s.owner, '{ agentSessions { nodes { issue { id } creator { id } } } }')
    ).agentSessions.nodes.filter((n: Json) => n.issue?.id === issue.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].creator?.id).toBe(s.owner.userId);
  });

  it("credits a delegation to whoever last changed the rule's actions", async () => {
    const s = await setup();
    const client = await createClient(s.owner.cookie);
    const tokens = await install(s.owner.cookie, client, { scope: 'read,write,app:assignable' });
    const appUserId = (await gqlData({ headers: bearer(tokens.access_token) }, '{ viewer { id } }'))
      .viewer.id as string;
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Open rule',
      trigger: 'entityCreated',
      editAccess: 'everyone',
      activities: [{ type: 'setPriority', priority: 2 }],
    });
    await plugin(s.member, 'workflows/update', {
      id: rule.id,
      activities: [{ type: 'setDelegate', appUserId }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId });
    const sessions = (
      await gqlData(s.owner, '{ agentSessions { nodes { issue { id } creator { id } } } }')
    ).agentSessions.nodes.filter((n: Json) => n.issue?.id === issue.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].creator?.id).toBe(s.member.userId);
  });

  it("reads me in a rule's conditions as its owner", async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Mine',
      trigger: 'entityCreated',
      editAccess: 'everyone',
      conditions: { assignee: { isMe: { eq: true } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const forOwner = await createIssue(s.member, { teamId: s.teamId, assigneeId: s.owner.userId });
    const forMember = await createIssue(s.owner, { teamId: s.teamId, assigneeId: s.member.userId });
    expect((await issueDetail(s.owner, forOwner.id)).priority).toBe(1);
    expect((await issueDetail(s.owner, forMember.id)).priority).not.toBe(1);

    // The member changes the conditions, so "me" is now the member.
    await plugin(s.member, 'workflows/update', {
      id: rule.id,
      conditions: { assignee: { isMe: { eq: true } } },
    });
    const forMemberNow = await createIssue(s.owner, {
      teamId: s.teamId,
      assigneeId: s.member.userId,
    });
    expect((await issueDetail(s.owner, forMemberNow.id)).priority).toBe(1);
  });

  it('matches me with no one when a rule has no owner', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Mine',
      trigger: 'entityCreated',
      conditions: { assignee: { isMe: { eq: true } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    // A rule's owner cannot be cleared through the API; an owner that no longer
    // exists leaves the column null (ON DELETE SET NULL), which this stands in for.
    await db
      .update(workflowDefinition)
      .set({ ownerUserId: null })
      .where(eq(workflowDefinition.id, rule.id));
    const issue = await createIssue(s.member, { teamId: s.teamId, assigneeId: s.owner.userId });
    expect((await issueDetail(s.owner, issue.id)).priority).not.toBe(1);
  });

  it('does not run a rule whose conditions an earlier rule in the same change broke', async () => {
    const s = await setup();
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Start urgent',
      trigger: 'entityUpdated',
      sortOrder: 1,
      conditions: { priority: { eq: 1 } },
      activities: [{ type: 'setState', stateId: s.states.started }],
    });
    const triage = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Triage urgent backlog',
      trigger: 'entityUpdated',
      sortOrder: 2,
      conditions: { and: [{ priority: { eq: 1 } }, { state: { type: { eq: 'backlog' } } }] },
      activities: [{ type: 'setAssignee', userId: s.member.userId }],
    });
    const issue = await createIssue(s.owner, {
      teamId: s.teamId,
      priority: 3,
      stateId: s.states.backlog,
    });
    await updateIssue(s.owner, issue.id, { priority: 1 });
    const detail = await issueDetail(s.owner, issue.id);
    expect(detail.state.id).toBe(s.states.started);
    expect(detail.assignee).toBeNull();
    expect((await ruleRow(triage.id)).stats.runs).toBe(0);
  });

  it('starts matching on subscribers set in the same update as other fields', async () => {
    const s = await setup();
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Watched by Ann',
      trigger: 'entityUpdated',
      conditions: { subscribers: { some: { id: { eq: s.member.userId } } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    await updateIssue(s.owner, issue.id, {
      title: 'Watched',
      subscriberIds: [s.owner.userId, s.member.userId],
    });
    expect((await issueDetail(s.owner, issue.id)).priority).toBe(1);
    expect((await ruleRow(rule.id)).stats.runs).toBe(1);
  });

  it('starts matching on a label added in the same update', async () => {
    const s = await setup();
    const label = await createLabel(s.owner, { name: 'urgent', teamId: s.teamId });
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Prioritise urgent',
      trigger: 'entityUpdated',
      conditions: { labels: { some: { id: { eq: label.id } } } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    await updateIssue(s.owner, issue.id, { labelIds: [label.id] });
    expect((await issueDetail(s.owner, issue.id)).priority).toBe(1);
    expect((await ruleRow(rule.id)).stats.runs).toBe(1);
  });

  it('clears the recorded error once a rule runs cleanly again', async () => {
    const s = await setup();
    const label = await createLabel(s.owner, { name: 'flaky', teamId: s.teamId });
    const rule = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Label new',
      trigger: 'entityCreated',
      activities: [{ type: 'addLabels', labelIds: [label.id] }],
    });
    const retire = `mutation ($id: String!) { issueLabelRetire(id: $id) { success } }`;
    const restore = `mutation ($id: String!) { issueLabelRestore(id: $id) { success } }`;
    await gqlData(s.owner, retire, { id: label.id });
    await createIssue(s.member, { teamId: s.teamId });
    expect(typeof (await ruleRow(rule.id)).stats.lastError).toBe('string');
    await gqlData(s.owner, restore, { id: label.id });
    await createIssue(s.member, { teamId: s.teamId });
    const stats = (await ruleRow(rule.id)).stats;
    expect(stats.runs).toBe(2);
    expect(stats.lastError).toBeUndefined();
  });

  it('records a failing rule and still runs the rules after it', async () => {
    const s = await setup();
    const label = await createLabel(s.owner, { name: 'gone', teamId: s.teamId });
    const failing = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Label',
      trigger: 'entityCreated',
      sortOrder: 1,
      activities: [{ type: 'addLabels', labelIds: [label.id] }],
    });
    const next = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Prioritise',
      trigger: 'entityCreated',
      sortOrder: 2,
      activities: [{ type: 'setPriority', priority: 2 }],
    });
    await gqlData(s.owner, `mutation ($id: String!) { issueLabelRetire(id: $id) { success } }`, {
      id: label.id,
    });
    const issue = await createIssue(s.member, { teamId: s.teamId, priority: 4 });
    expect((await issueDetail(s.owner, issue.id)).priority).toBe(2);
    const failed = (await ruleRow(failing.id)).stats;
    expect(failed.runs).toBe(1);
    expect(typeof failed.lastError).toBe('string');
    expect((await ruleRow(next.id)).stats.runs).toBe(1);
  });

  it('does not run disabled or archived rules', async () => {
    const s = await setup();
    const disabled = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Disabled',
      trigger: 'entityCreated',
      enabled: false,
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const archived = await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Archived',
      trigger: 'entityCreated',
      activities: [{ type: 'setPriority', priority: 2 }],
    });
    await plugin(s.owner, 'workflows/archive', { id: archived.id });
    const issue = await createIssue(s.owner, { teamId: s.teamId, priority: 4 });
    expect((await issueDetail(s.owner, issue.id)).priority).toBe(4);
    expect((await ruleRow(disabled.id)).stats.runs).toBe(0);
  });
});

describe('workflow run cost', () => {
  it("loads a team's rules once for a batch update and costs the same per issue", async () => {
    const s = await setup();
    await createRule(s.owner, {
      teamId: s.teamId,
      name: 'Never matches',
      trigger: 'entityUpdated',
      activationMode: 'conditionsStartedMatching',
      conditions: { title: { eq: 'no such title' } },
      activities: [{ type: 'setPriority', priority: 1 }],
    });
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await createIssue(s.owner, { teamId: s.teamId })).id);
    const batch = (issues: string[], priority: number) => () =>
      gqlData(
        s.owner,
        `mutation ($ids: [UUID!]!, $p: Int!) { issueBatchUpdate(ids: $ids, input: { priority: $p }) { success } }`,
        { ids: issues, p: priority },
      );

    expect(await countStatements(batch(ids, 3), 'from "workflow_definition"')).toBe(1);
    // Five more issues cost five times what one more issue does.
    const five = await countStatements(batch(ids.slice(0, 5), 2));
    const ten = await countStatements(batch(ids, 1));
    const six = await countStatements(batch(ids.slice(0, 6), 4));
    expect(ten - five).toBe(5 * (six - five));
  });
});
