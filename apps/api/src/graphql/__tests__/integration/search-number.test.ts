import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { createTeam } from '../../../__tests__/helpers/graphql';

// searchIssues finds an issue by its number: a bare number ("2") or an identifier
// ("MKT-2"), as Linear's search does, next to the title and
// description match.

const SEARCH = `query($term: String!, $teamId: String) {
  searchIssues(term: $term, teamId: $teamId) { nodes { identifier } }
}`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const create = (teamKey: string, title: string) =>
    gql(
      { cookie: owner.cookie },
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success } }`,
      { input: { teamId: teamKey, title } },
    );
  for (const title of ['Launch plan', 'Pricing page', 'Item 2 of the list'])
    await create('MKT', title);
  await create('ENG', 'Build');
  await create('ENG', 'Deploy');
  return owner;
}

const ids = async (cookie: string, term: string, teamId?: string) => {
  const res = await gql({ cookie }, SEARCH, { term, teamId });
  return (res.body.data?.searchIssues as { nodes: { identifier: string }[] }).nodes
    .map((n) => n.identifier)
    .sort();
};

describe('graphql searchIssues by number', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('matches an identifier in its team only', async () => {
    const owner = await setup();
    expect(await ids(owner.cookie, 'MKT-2')).toEqual(['MKT-2']);
    expect(await ids(owner.cookie, 'eng-2')).toEqual(['ENG-2']);
    expect(await ids(owner.cookie, 'OPS-2')).toEqual([]);
  });

  it('matches a bare number in every team, plus title matches', async () => {
    const owner = await setup();
    expect(await ids(owner.cookie, '2')).toEqual(['ENG-2', 'MKT-2', 'MKT-3']);
    expect(await ids(owner.cookie, '2', 'MKT')).toEqual(['MKT-2', 'MKT-3']);
  });
});
