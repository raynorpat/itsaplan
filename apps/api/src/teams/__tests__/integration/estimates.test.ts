import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  updateTeam,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Team estimate scales (Linear's Team.issueEstimation* and defaultIssueEstimate): the
// settings through teamUpdate, and the issue estimate checked against the scale.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

const SETTINGS = `issueEstimationType issueEstimationExtended issueEstimationAllowZero
  defaultIssueEstimate inheritIssueEstimation`;

async function settings(as: TestUser, key: string) {
  return (await gqlData(as, `query ($id: String!) { team(id: $id) { ${SETTINGS} } }`, { id: key }))
    .team;
}

const setEstimate = (as: TestUser, id: string, estimate: number | null) =>
  gql(
    { cookie: as.cookie },
    `mutation ($id: String!, $e: Int) { issueUpdate(id: $id, input: { estimate: $e }) { issue { estimate } } }`,
    { id, e: estimate },
  );

const estimateOf = async (as: TestUser, id: string) =>
  (await gqlData(as, `query ($id: String!) { issue(id: $id) { estimate } }`, { id })).issue
    .estimate;

describe('team estimates', () => {
  let owner: TestUser;
  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser();
    await createTeam(owner, { key: 'ENG' });
  });

  it('starts with estimates off and a default estimate of 1', async () => {
    expect(await settings(owner, 'ENG')).toEqual({
      issueEstimationType: 'notUsed',
      issueEstimationExtended: false,
      issueEstimationAllowZero: false,
      defaultIssueEstimate: 1,
      inheritIssueEstimation: false,
    });
  });

  it('changes the settings through teamUpdate', async () => {
    await updateTeam(owner, 'ENG', {
      issueEstimationType: 'fibonacci',
      issueEstimationExtended: true,
      issueEstimationAllowZero: true,
      defaultIssueEstimate: 0,
    });
    expect(await settings(owner, 'ENG')).toMatchObject({
      issueEstimationType: 'fibonacci',
      issueEstimationExtended: true,
      issueEstimationAllowZero: true,
      defaultIssueEstimate: 0,
    });
  });

  it('refuses an unknown type, a negative default and inheritance', async () => {
    const run = (input: string) =>
      gql(
        { cookie: owner.cookie },
        `mutation { teamUpdate(id: "ENG", input: ${input}) { success } }`,
      );
    expect(code(await run('{ issueEstimationType: "days" }'))).toBe('INVALID_INPUT');
    expect(code(await run('{ defaultIssueEstimate: -1 }'))).toBe('INVALID_INPUT');
    expect(code(await run('{ inheritIssueEstimation: true }'))).toBe('INVALID_INPUT');
  });

  it('lets only a team manager change the settings', async () => {
    const guest = await signUpAs('guest');
    await addMember(owner, 'ENG', guest.userId);
    const res = await gql(
      { cookie: guest.cookie },
      `mutation { teamUpdate(id: "ENG", input: { issueEstimationType: "linear" }) { success } }`,
    );
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('refuses any estimate while estimates are off', async () => {
    const issue = await createIssue(owner, { teamId: 'ENG' });
    expect(code(await setEstimate(owner, issue.id, 1))).toBe('INVALID_INPUT');
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { issueCreate(input: { teamId: "ENG", title: "x", estimate: 2 }) { success } }`,
    );
    expect(code(created)).toBe('INVALID_INPUT');
    // Clearing is always allowed.
    expect((await setEstimate(owner, issue.id, null)).body.errors).toBeUndefined();
  });

  it('accepts only values on the scale, extended and zero when turned on', async () => {
    await updateTeam(owner, 'ENG', { issueEstimationType: 'fibonacci' });
    const issue = await createIssue(owner, { teamId: 'ENG', estimate: 5 });
    expect(await estimateOf(owner, issue.id)).toBe(5);
    expect(code(await setEstimate(owner, issue.id, 4))).toBe('INVALID_INPUT');
    expect(code(await setEstimate(owner, issue.id, 13))).toBe('INVALID_INPUT');
    expect(code(await setEstimate(owner, issue.id, 0))).toBe('INVALID_INPUT');
    await updateTeam(owner, 'ENG', {
      issueEstimationExtended: true,
      issueEstimationAllowZero: true,
    });
    expect((await setEstimate(owner, issue.id, 21)).body.errors).toBeUndefined();
    expect((await setEstimate(owner, issue.id, 0)).body.errors).toBeUndefined();
    expect((await setEstimate(owner, issue.id, null)).body.errors).toBeUndefined();
    expect(await estimateOf(owner, issue.id)).toBeNull();
  });

  it('stores T-shirt sizes as their numbers', async () => {
    await updateTeam(owner, 'ENG', { issueEstimationType: 'tShirt' });
    const issue = await createIssue(owner, { teamId: 'ENG' });
    expect((await setEstimate(owner, issue.id, 3)).body.errors).toBeUndefined();
    expect(code(await setEstimate(owner, issue.id, 4))).toBe('INVALID_INPUT');
  });

  it('refuses a whole batch when one issue is off its team scale', async () => {
    await createTeam(owner, { key: 'OPS' });
    await updateTeam(owner, 'ENG', { issueEstimationType: 'exponential' });
    await updateTeam(owner, 'OPS', { issueEstimationType: 'linear' });
    const eng = await createIssue(owner, { teamId: 'ENG', estimate: 1 });
    const ops = await createIssue(owner, { teamId: 'OPS', estimate: 1 });
    // 3 is on the linear scale but not the exponential one.
    const res = await gql(
      { cookie: owner.cookie },
      `mutation ($ids: [UUID!]!) { issueBatchUpdate(ids: $ids, input: { estimate: 3 }) { success } }`,
      { ids: [ops.id, eng.id] },
    );
    expect(code(res)).toBe('INVALID_INPUT');
    expect(await estimateOf(owner, ops.id)).toBe(1);
    expect(await estimateOf(owner, eng.id)).toBe(1);
  });

  it('keeps stored estimates when estimates are turned off and on again', async () => {
    await updateTeam(owner, 'ENG', { issueEstimationType: 'fibonacci' });
    const issue = await createIssue(owner, { teamId: 'ENG', estimate: 8 });
    await updateTeam(owner, 'ENG', { issueEstimationType: 'notUsed' });
    expect(await estimateOf(owner, issue.id)).toBe(8);
    await updateTeam(owner, 'ENG', { issueEstimationType: 'fibonacci' });
    expect(await estimateOf(owner, issue.id)).toBe(8);
  });

  it('takes the estimate settings in teamCreate, with the same checks', async () => {
    const create = (input: Record<string, unknown>) =>
      gql(
        { cookie: owner.cookie },
        `mutation ($input: TeamCreateInput!) { teamCreate(input: $input) { team { key ${SETTINGS} } } }`,
        { input },
      );
    const ok = await create({
      name: 'Design',
      key: 'DES',
      issueEstimationType: 'tShirt',
      issueEstimationExtended: true,
      issueEstimationAllowZero: true,
      defaultIssueEstimate: 2,
    });
    expect(ok.body.errors).toBeUndefined();
    expect((ok.body.data as { teamCreate: { team: unknown } }).teamCreate.team).toMatchObject({
      issueEstimationType: 'tShirt',
      issueEstimationExtended: true,
      issueEstimationAllowZero: true,
      defaultIssueEstimate: 2,
    });
    expect(code(await create({ name: 'Bad', key: 'BAD', issueEstimationType: 'hours' }))).toBe(
      'INVALID_INPUT',
    );
    expect(code(await create({ name: 'Neg', key: 'NEG', defaultIssueEstimate: -1 }))).toBe(
      'INVALID_INPUT',
    );
  });
});
