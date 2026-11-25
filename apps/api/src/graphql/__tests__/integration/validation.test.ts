import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { createIssue, createTeam, teamView } from '../../../__tests__/helpers/graphql';

// Bad input over GraphQL is a client error (INVALID_INPUT / ENTITY_NOT_FOUND),
// never an internal error from a failed Postgres cast or constraint.

async function setup() {
  const owner = await signUpTestUser();
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const view = await teamView(owner, 'MKT');
  const stateId = view.states[0]!.id;
  const issue = await createIssue(owner, { teamId: 'MKT', stateId, title: 'x' });
  const run = (query: string) => gql({ cookie: owner.cookie }, query);
  return { run, issue };
}

const codeOf = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql input validation', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects ids that are not UUIDs in issue input', async () => {
    const { run, issue } = await setup();
    for (const field of ['stateId', 'parentId', 'assigneeId', 'delegateId']) {
      const res = await run(
        `mutation { issueUpdate(id: "${issue.id}", input: { ${field}: "abc" }) { success } }`,
      );
      expect(codeOf(res)).toBe('INVALID_INPUT');
    }
  });

  it('rejects an out-of-range priority, a bad date and an empty title', async () => {
    const { run, issue } = await setup();
    for (const input of ['priority: 9', 'dueDate: "nope"', 'title: ""']) {
      const res = await run(
        `mutation { issueUpdate(id: "${issue.id}", input: { ${input} }) { success } }`,
      );
      expect(codeOf(res)).toBe('INVALID_INPUT');
    }
  });

  it('answers ENTITY_NOT_FOUND for an identifier number out of range', async () => {
    const { run } = await setup();
    expect(codeOf(await run('{ issue(id: "MKT-99999999999") { id } }'))).toBe('ENTITY_NOT_FOUND');
  });

  it('rejects filter values Postgres cannot read', async () => {
    const { run } = await setup();
    for (const filter of [
      'createdAt: { gt: "-P2W" }',
      'dueDate: { lt: "x" }',
      'number: { eq: 99999999999 }',
    ]) {
      const res = await run(`{ issues(filter: { ${filter} }) { nodes { id } } }`);
      expect(codeOf(res)).toBe('INVALID_INPUT');
    }
  });

  it('refuses a query nested deeper than the limit', async () => {
    const { run } = await setup();
    let selection = 'id';
    for (let i = 0; i < 10; i++) selection = `children { nodes { ${selection} } }`;
    const res = await run(`{ issues { nodes { ${selection} } } }`);
    expect(res.body.errors?.[0]?.message).toContain('depth');
    expect(res.body.data).toBeUndefined();
  });
});
