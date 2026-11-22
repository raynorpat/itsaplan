import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
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
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const state = (type: string) => team.states.find((s) => s.stateType === type)!.id;
  const make = async (title: string, stateId = state('unstarted'), teamKey = 'MKT') =>
    (await asOwner.teams({ teamKey }).issues.post({ stateId, title })).data!;
  return { owner, asOwner, state, make };
}

const feed = async (api: Api, issueId: string) =>
  (await api.issues({ issueId }).feed.get()).data!.items.filter((i) => i.action === 'relation');

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
    const { owner, asOwner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'blocks' },
      owner.userId,
    );
    expect(relation).toMatchObject({ issueId: a.id, relatedIssueId: b.id, type: 'blocks' });
    expect(await feed(asOwner, a.id)).toMatchObject([
      { subject: 'blocks', toText: b.identifier, fromText: null },
    ]);
    expect(await feed(asOwner, b.id)).toMatchObject([
      { subject: 'blocked_by', toText: a.identifier },
    ]);
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
    const { owner, asOwner, make } = await setup();
    const duplicateState = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .states.post({ name: 'duplicate', stateType: 'canceled' })
    ).data!;
    const [a, b] = [await make('A'), await make('B')];
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect((await asOwner.issues({ issueId: a.id }).get()).data!.stateId).toBe(duplicateState.id);

    await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
    const opsState = (type: string) => ops.states.find((s) => s.stateType === type)!.id;
    const firstCanceled = ops.states
      .filter((s) => s.stateType === 'canceled')
      .sort((x, y) => x.position - y.position)[0]!;
    const c = await make('C', opsState('started'), 'OPS');
    await createIssueRelation(
      { issueId: c.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect((await asOwner.issues({ issueId: c.id }).get()).data!.stateId).toBe(firstCanceled.id);
  });

  it('leaves a completed duplicate alone', async () => {
    const { owner, asOwner, state, make } = await setup();
    const a = await make('A', state('completed'));
    const b = await make('B');
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'duplicate' },
      owner.userId,
    );
    expect((await asOwner.issues({ issueId: a.id }).get()).data!.stateId).toBe(state('completed'));
  });

  it('logs a change as a removal and an addition', async () => {
    const { owner, asOwner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'blocks' },
      owner.userId,
    );
    await updateIssueRelation(relation.id, { type: 'related' }, owner.userId);
    const entries = await feed(asOwner, a.id);
    expect(entries).toContainEqual(
      expect.objectContaining({ subject: 'blocks', fromText: b.identifier, toText: null }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ subject: 'related', toText: b.identifier }),
    );
    await deleteIssueRelation(relation.id, owner.userId);
    expect(await getIssueRelation(relation.id)).toBeNull();
  });

  it('removes relations with a deleted issue', async () => {
    const { owner, asOwner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = await createIssueRelation(
      { issueId: a.id, relatedIssueId: b.id, type: 'related' },
      owner.userId,
    );
    await asOwner.issues({ issueId: b.id }).delete();
    expect(await getIssueRelation(relation.id)).toBeNull();
  });

  it("does not name another team's issue in the history", async () => {
    const { owner, asOwner, make } = await setup();
    await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
    const a = await make('A');
    const c = await make('C', ops.states.find((s) => s.stateType === 'unstarted')!.id, 'OPS');
    await createIssueRelation(
      { issueId: a.id, relatedIssueId: c.id, type: 'blocks' },
      owner.userId,
    );
    const [entry] = await feed(asOwner, a.id);
    expect(entry!.toText).not.toContain(c.identifier);
    expect(entry!.toText).toBe('an issue in another team');
  });
});
