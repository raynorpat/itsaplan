import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createState,
  createTeam,
  gqlData,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import {
  createIssueRelation,
  deleteIssueRelation,
  getIssueRelation,
  updateIssueRelation,
} from '../../relations';

// Issue relations: blocks / related / duplicate, one per pair, history on both
// issues, and a duplicate closed in the team's Duplicate (or first canceled) state.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const state = (type: string) => view.states.find((s) => s.stateType === type)!.id;
  const make = (title: string, stateId = state('unstarted'), teamKey = 'MKT') =>
    createIssue(owner, { teamId: teamKey, stateId, title });
  return { owner, state, make };
}

// The issue's relation history (Linear's IssueHistory.relationChanges), oldest first.
const relationHistory = async (who: TestUser, issueId: string) =>
  (
    await gqlData(
      who,
      `{ issue(id: "${issueId}") { history(first: 50) { nodes { createdAt relationChanges { identifier type } } } } }`,
    )
  ).issue.history.nodes
    .filter((h: { relationChanges: unknown[] | null }) => h.relationChanges)
    .reverse()
    .flatMap((h: { relationChanges: { identifier: string; type: string }[] }) => h.relationChanges);
const stateOf = async (who: TestUser, issueId: string) =>
  (await gqlData(who, `{ issue(id: "${issueId}") { state { id } } }`)).issue.state.id as string;

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

describe('issue relations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a blocking relation and logs it on both issues', async () => {
    const { owner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'blocks' },
      owner.userId,
    );
    expect(relation).toMatchObject({ issueId: a.id, relatedIssueId: b.id, type: 'blocks' });
    expect(await relationHistory(owner, a.id)).toEqual([{ identifier: b.identifier, type: 'ax' }]);
    expect(await relationHistory(owner, b.id)).toEqual([{ identifier: a.identifier, type: 'ab' }]);
  });

  it('rejects a self relation, a second relation in either direction and similar', async () => {
    const { owner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const create = (issueId: string, relatedIssueId: string, type = 'related') =>
      status(createIssueRelation({ issueId, relatedIssueId, type }, owner.userId));
    expect(await create(a.id, a.id)).toBe(400);
    expect(await create(a.id, b.id, 'similar')).toBe(400);
    expect(await create(a.id, b.id)).toBe(200);
    expect(await create(a.id, b.id, 'blocks')).toBe(400);
    expect(await create(b.id, a.id, 'blocks')).toBe(400);
  });

  it("closes a duplicate in the team's Duplicate state, else the first canceled state", async () => {
    const { owner, make } = await setup();
    const duplicateState = await createState(owner, {
      teamId: 'MKT',
      name: 'duplicate',
      type: 'canceled',
    });
    const [a, b] = [await make('A'), await make('B')];
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect(await stateOf(owner, a.id)).toBe(duplicateState.id);

    const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
    const opsState = (type: string) => ops.states.find((s) => s.stateType === type)!.id;
    const firstCanceled = ops.states
      .filter((s) => s.stateType === 'canceled')
      .sort((x, y) => x.position - y.position)[0]!;
    const c = await make('C', opsState('started'), 'OPS');
    await createIssueRelation(
      { issueId: c.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect(await stateOf(owner, c.id)).toBe(firstCanceled.id);
  });

  it('leaves a completed duplicate alone', async () => {
    const { owner, state, make } = await setup();
    const a = await make('A', state('completed'));
    const b = await make('B');
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect(await stateOf(owner, a.id)).toBe(state('completed'));
  });

  it('logs a change as a removal and an addition', async () => {
    const { owner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'blocks' },
      owner.userId,
    );
    await updateIssueRelation(relation.id, { type: 'related' }, owner.userId);
    const entries = await relationHistory(owner, a.id);
    expect(entries).toContainEqual({ identifier: b.identifier, type: 'rx' });
    expect(entries).toContainEqual({ identifier: b.identifier, type: 'ar' });
    await deleteIssueRelation(relation.id, owner.userId);
    expect(await getIssueRelation(relation.id)).toBeNull();
  });

  it('removes relations with a deleted issue', async () => {
    const { owner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'related' },
      owner.userId,
    );
    await gqlData(
      owner,
      `mutation { issueDelete(id: "${b.id}", permanentlyDelete: true) { success } }`,
    );
    expect(await getIssueRelation(relation.id)).toBeNull();
  });

  it("does not name another team's issue to someone who cannot see it", async () => {
    const { owner, make } = await setup();
    const ops = await createTeam(owner, { key: 'OPS', name: 'Operations', private: true });
    const a = await make('A');
    const c = await make('C', ops.states.find((s) => s.stateType === 'unstarted')!.id, 'OPS');
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: c.id, type: 'blocks' },
      owner.userId,
    );
    expect(await relationHistory(owner, a.id)).toEqual([{ identifier: c.identifier, type: 'ax' }]);
    const member = await signUpAs('member');
    expect(JSON.stringify(await relationHistory(member, a.id))).not.toContain(c.identifier);
  });

  it('reports a missing issue as not found and a reused id as a conflict', async () => {
    const { owner, make } = await setup();
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    expect(
      await status(
        createIssueRelation(
          {
            issueId: a.id,
            relatedIssueId: '00000000-0000-4000-8000-000000000000',
            type: 'related',
          },
          owner.userId,
        ),
      ),
    ).toBe(404);
    const first = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'related' },
      owner.userId,
    );
    expect(
      await status(
        createIssueRelation(
          { issueId: a.id, relatedIssueId: c.id, type: 'related', id: first.id },
          owner.userId,
        ),
      ),
    ).toBe(409);
  });
});
