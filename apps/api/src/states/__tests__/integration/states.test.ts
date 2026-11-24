import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  archiveIssue,
  createIssue,
  createState,
  createTeam,
  gqlData,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Workflow states over GraphQL: name and description rules, archiving (empty states
// only, never the last of a type), archived states as issue targets, restoring an
// archived issue, and access. Create, update, reorder and the archived listing are in
// the GraphQL mutations and teams-states tests.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setupTeam() {
  const owner = await signUpTestUser();
  const { team } = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: team.id };
}

const archiveState = (who: TestUser, id: string) =>
  gql({ cookie: who.cookie }, `mutation { workflowStateArchive(id: "${id}") { success } }`);
const stateIds = async (who: TestUser) => (await teamView(who, 'MKT')).states.map((s) => s.id);

describe('workflow states', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects an empty name on create and update', async () => {
    const { owner, teamId } = await setupTeam();
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "", type: "started", color: "#000000" }) { success } }`,
    );
    expect(code(created)).toBe('INVALID_INPUT');
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    const updated = await gql(
      { cookie: owner.cookie },
      `mutation { workflowStateUpdate(id: "${review.id}", input: { name: "" }) { success } }`,
    );
    expect(code(updated)).toBe('INVALID_INPUT');
  });

  it('stores a description on create and update', async () => {
    const { owner, teamId } = await setupTeam();
    const review = await gqlData(
      owner,
      `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "Review", type: "started", color: "#000000", description: "Waiting" }) { workflowState { id description } } }`,
    );
    expect(review.workflowStateCreate.workflowState.description).toBe('Waiting');
    const id = review.workflowStateCreate.workflowState.id;
    const updated = await gqlData(
      owner,
      `mutation { workflowStateUpdate(id: "${id}", input: { description: "Ready" }) { workflowState { description } } }`,
    );
    expect(updated.workflowStateUpdate.workflowState.description).toBe('Ready');
  });

  it('archives an empty state and hides it from the team', async () => {
    const { owner, teamId } = await setupTeam();
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    expect((await archiveState(owner, review.id)).body.errors).toBeUndefined();
    expect(await stateIds(owner)).not.toContain(review.id);
  });

  it('refuses to archive a state that still has issues', async () => {
    const { owner, teamId } = await setupTeam();
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    await createIssue(owner, { teamId, stateId: review.id });
    expect(code(await archiveState(owner, review.id))).toBe('CONFLICT');
    expect(await stateIds(owner)).toContain(review.id);
  });

  it('refuses an archived state as an issue target', async () => {
    const { owner, teamId } = await setupTeam();
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    await archiveState(owner, review.id);
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { issueCreate(input: { teamId: "${teamId}", title: "x", stateId: "${review.id}" }) { success } }`,
    );
    expect(code(created)).toBe('INVALID_INPUT');
    const issue = await createIssue(owner, { teamId });
    const moved = await gql(
      { cookie: owner.cookie },
      `mutation { issueUpdate(id: "${issue.id}", input: { stateId: "${review.id}" }) { success } }`,
    );
    expect(code(moved)).toBe('INVALID_INPUT');
  });

  it('restores an archived issue of an archived state into an active state of the same type', async () => {
    const { owner, teamId } = await setupTeam();
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    const issue = await createIssue(owner, { teamId, stateId: review.id });
    await archiveIssue(owner, issue.id);
    expect((await archiveState(owner, review.id)).body.errors).toBeUndefined();
    await gqlData(owner, `mutation { issueUnarchive(id: "${issue.id}") { success } }`);
    const restored = await gqlData(owner, `{ issue(id: "${issue.id}") { state { id type } } }`);
    expect(restored.issue.state.type).toBe('started');
    expect(restored.issue.state.id).not.toBe(review.id);
    expect(await stateIds(owner)).toContain(restored.issue.state.id);
  });

  it("keeps a guest outside the team, and another team's owner, off its states", async () => {
    const { owner, teamId } = await setupTeam();
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    const guest = await signUpAs('guest');
    expect(code(await archiveState(guest, review.id))).toBe('ENTITY_NOT_FOUND');
    const update = await gql(
      { cookie: guest.cookie },
      `mutation { workflowStateUpdate(id: "${review.id}", input: { name: "Hijacked" }) { success } }`,
    );
    expect(code(update)).toBe('ENTITY_NOT_FOUND');
    const member = await signUpAs('member');
    await createTeam(member, { key: 'OPS', name: 'Ops' });
    expect(code(await archiveState(member, review.id))).toBe('FORBIDDEN');
    expect(await stateIds(owner)).toContain(review.id);
  });
});
