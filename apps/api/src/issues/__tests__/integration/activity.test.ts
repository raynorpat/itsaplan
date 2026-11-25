import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createIssue, createLabel, createTeam, gqlData } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// An issue's change log as GraphQL serves it (Issue.history) and comment input
// rules. Typed history for each field is in the GraphQL history test.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser();
  const { team } = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const issue = await createIssue(owner, { teamId: team.id, title: 'Task' });
  return { owner, teamId: team.id, issue };
}

const history = async (who: TestUser, id: string) =>
  (
    await gqlData(
      who,
      `{ issue(id: "${id}") { history(first: 50) { nodes { id addedLabelIds removedLabelIds fromTitle toTitle } } } }`,
    )
  ).issue.history.nodes as {
    id: string;
    addedLabelIds: string[] | null;
    removedLabelIds: string[] | null;
    fromTitle: string | null;
    toTitle: string | null;
  }[];

describe('issue activity', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('logs added and removed labels', async () => {
    const { owner, teamId, issue } = await setup();
    const label = await createLabel(owner, { teamId, name: 'bug' });
    await gqlData(
      owner,
      `mutation { issueUpdate(id: "${issue.id}", input: { labelIds: ["${label.id}"] }) { success } }`,
    );
    await gqlData(
      owner,
      `mutation { issueUpdate(id: "${issue.id}", input: { labelIds: [] }) { success } }`,
    );
    const nodes = await history(owner, issue.id);
    expect(nodes.some((n) => n.addedLabelIds?.includes(label.id))).toBe(true);
    expect(nodes.some((n) => n.removedLabelIds?.includes(label.id))).toBe(true);
  });

  it("logs nothing for another team's label, which is refused", async () => {
    const { owner, issue } = await setup();
    const ops = (await createTeam(owner, { key: 'OPS', name: 'Operations' })).team.id;
    const foreign = await createLabel(owner, { teamId: ops, name: 'ops-secret' });
    const before = (await history(owner, issue.id)).length;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueUpdate(id: "${issue.id}", input: { labelIds: ["${foreign.id}"] }) { success } }`,
    );
    expect(code(res)).toBe('INVALID_INPUT');
    expect((await history(owner, issue.id)).length).toBe(before);
  });

  it('does not log a sort-order-only change', async () => {
    const { owner, issue } = await setup();
    const before = (await history(owner, issue.id)).length;
    await gqlData(
      owner,
      `mutation { issueUpdate(id: "${issue.id}", input: { sortOrder: 42 }) { success } }`,
    );
    expect((await history(owner, issue.id)).length).toBe(before);
  });

  it('rejects an empty comment body and a comment on a missing issue', async () => {
    const { owner, issue } = await setup();
    const empty = await gql(
      { cookie: owner.cookie },
      `mutation { commentCreate(input: { issueId: "${issue.id}", body: "" }) { success } }`,
    );
    expect(code(empty)).toBe('INVALID_INPUT');
    const missing = await gql(
      { cookie: owner.cookie },
      `mutation { commentCreate(input: { issueId: "${crypto.randomUUID()}", body: "x" }) { success } }`,
    );
    expect(code(missing)).toBe('ENTITY_NOT_FOUND');
  });
});
