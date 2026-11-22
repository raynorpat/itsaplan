import { beforeEach, describe, expect, it } from 'bun:test';
import { IssueRelationType } from '@linear/sdk';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Issue relations over the Linear API: CRUD, Issue.relations / inverseRelations,
// the duplicate rule, visibility, the has*Relations filters, access errors.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'SEC', name: 'Secret' });
  const client = linearClient(await createApiKey(owner.cookie));
  const states = async (key: string) => (await asOwner.teams({ teamKey: key }).get()).data!.states;
  const make = async (title: string, key = 'MKT') => {
    const stateId = (await states(key)).find((s) => s.stateType === 'unstarted')!.id;
    return (await asOwner.teams({ teamKey: key }).issues.post({ stateId, title })).data!;
  };
  return { owner, asOwner, client, make };
}

async function memberOf(asOwner: ReturnType<typeof authedApi>, teamKey: string, roleId?: string) {
  const user = await signUpTestUser();
  const invite = await asOwner
    .teams({ teamKey })
    .invites.post({ email: user.email, role: 'member', ...(roleId ? { roleId } : {}) });
  await authedApi(user.cookie).invites({ token: invite.data!.token }).accept.post();
  return { user, client: linearClient(await createApiKey(user.cookie)) };
}

const titles = async (cookie: string, filter: string) => {
  const res = await gql({ cookie }, `{ issues(filter: ${filter}) { nodes { title } } }`);
  return (res.body.data as { issues: { nodes: { title: string }[] } }).issues.nodes
    .map((n) => n.title)
    .sort();
};

describe('graphql issue relations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, reads and deletes a relation', async () => {
    const { client, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = (await (
      await client.createIssueRelation({
        issueId: a.id,
        relatedIssueId: b.id,
        type: IssueRelationType.Blocks,
      })
    ).issueRelation)!;
    expect(relation.type).toBe('blocks');
    const relations = (await (await client.issue(a.id)).relations()).nodes;
    expect(relations.map((r) => r.id)).toEqual([relation.id]);
    expect((await relations[0]!.relatedIssue)?.id).toBe(b.id);
    const inverse = (await (await client.issue(b.id)).inverseRelations()).nodes;
    expect((await inverse[0]!.issue)?.id).toBe(a.id);
    expect((await client.issueRelation(relation.id)).id).toBe(relation.id);
    expect((await client.issueRelations()).nodes).toHaveLength(1);
    expect((await client.deleteIssueRelation(relation.id)).success).toBe(true);
    expect((await client.issueRelations()).nodes).toHaveLength(0);
  });

  it('closes the issue when a relation becomes a duplicate', async () => {
    const { client, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = (await (
      await client.createIssueRelation({
        issueId: a.id,
        relatedIssueId: b.id,
        type: IssueRelationType.Related,
      })
    ).issueRelation)!;
    await client.updateIssueRelation(relation.id, { type: 'duplicate' });
    expect((await (await client.issue(a.id)).state)?.type).toBe('canceled');
  });

  it('hides relations to issues the viewer cannot see', async () => {
    const { owner, asOwner, client, make } = await setup();
    const a = await make('A');
    const c = await make('C', 'SEC');
    await client.createIssueRelation({
      issueId: a.id,
      relatedIssueId: c.id,
      type: IssueRelationType.Blocks,
    });
    const member = await memberOf(asOwner, 'MKT');
    expect((await (await member.client.issue(a.id)).relations()).nodes).toHaveLength(0);
    expect((await member.client.issueRelations()).nodes).toHaveLength(0);
    expect(await titles(member.user.cookie, '{ hasBlockingRelations: { eq: true } }')).toEqual([]);
    expect(await titles(owner.cookie, '{ hasBlockingRelations: { eq: true } }')).toEqual(['A']);
  });

  it('filters by relation existence', async () => {
    const { owner, client, make } = await setup();
    const [a, b, c, d] = [await make('A'), await make('B'), await make('C'), await make('D')];
    await client.createIssueRelation({
      issueId: a.id,
      relatedIssueId: b.id,
      type: IssueRelationType.Blocks,
    });
    await client.createIssueRelation({
      issueId: c.id,
      relatedIssueId: d.id,
      type: IssueRelationType.Related,
    });
    expect(await titles(owner.cookie, '{ hasBlockedByRelations: { eq: true } }')).toEqual(['B']);
    expect(await titles(owner.cookie, '{ hasRelatedRelations: { eq: true } }')).toEqual(['C', 'D']);
    expect(await titles(owner.cookie, '{ hasRelatedRelations: { eq: false } }')).toEqual([
      'A',
      'B',
    ]);
    expect(await titles(owner.cookie, '{ hasDuplicateRelations: { eq: true } }')).toEqual([]);
  });

  it('rejects similar, hidden issues and missing edit permission', async () => {
    const { owner, asOwner, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const create = (cookie: string, type: string) =>
      gql(
        { cookie },
        `mutation { issueRelationCreate(input: { issueId: "${a.id}", relatedIssueId: "${b.id}", type: ${type} }) { success } }`,
      );
    expect(errorCode(await create(owner.cookie, 'similar'))).toBe('INVALID_INPUT');
    const outsider = await memberOf(asOwner, 'SEC');
    expect(errorCode(await create(outsider.user.cookie, 'related'))).toBe('ENTITY_NOT_FOUND');
    const role = await asOwner
      .teams({ teamKey: 'MKT' })
      .roles.post({ name: 'Readers', permissions: { work_items: { read: true } } });
    const reader = await memberOf(asOwner, 'MKT', role.data!.id);
    expect(errorCode(await create(reader.user.cookie, 'related'))).toBe('FORBIDDEN');
  });

  it("needs edit permission in the duplicate issue's team to mark it a duplicate", async () => {
    const { asOwner, client, make } = await setup();
    const mktIssue = await make('M');
    const secIssue = await make('S', 'SEC');
    const role = await asOwner
      .teams({ teamKey: 'SEC' })
      .roles.post({ name: 'Readers', permissions: { work_items: { read: true } } });
    const bob = await memberOf(asOwner, 'MKT');
    const invite = await asOwner
      .teams({ teamKey: 'SEC' })
      .invites.post({ email: bob.user.email, role: 'member', roleId: role.data!.id });
    await authedApi(bob.user.cookie).invites({ token: invite.data!.token }).accept.post();
    const res = await gql(
      { cookie: bob.user.cookie },
      `mutation { issueRelationCreate(input: { issueId: "${secIssue.id}", relatedIssueId: "${mktIssue.id}", type: duplicate }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect((await (await client.issue(secIssue.id)).state)?.type).toBe('unstarted');
  });

  it("does not reveal a hidden issue's id through a relation", async () => {
    const { asOwner, client, make } = await setup();
    const a = await make('A');
    const c = await make('C', 'SEC');
    const relation = (await (
      await client.createIssueRelation({
        issueId: c.id,
        relatedIssueId: a.id,
        type: IssueRelationType.Blocks,
      })
    ).issueRelation)!;
    const member = await memberOf(asOwner, 'MKT');
    expect((await (await member.client.issue(a.id)).inverseRelations()).nodes).toHaveLength(0);
    const res = await gql(
      { cookie: member.user.cookie },
      `{ issueRelation(id: "${relation.id}") { id } }`,
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    expect(JSON.stringify(res.body.errors)).not.toContain(c.id);
  });

  it('checks edit permission on update and delete', async () => {
    const { asOwner, client, make } = await setup();
    const [a, b] = [await make('A'), await make('B')];
    const relation = (await (
      await client.createIssueRelation({
        issueId: a.id,
        relatedIssueId: b.id,
        type: IssueRelationType.Related,
      })
    ).issueRelation)!;
    const role = await asOwner
      .teams({ teamKey: 'MKT' })
      .roles.post({ name: 'Readers', permissions: { work_items: { read: true } } });
    const reader = await memberOf(asOwner, 'MKT', role.data!.id);
    const update = await gql(
      { cookie: reader.user.cookie },
      `mutation { issueRelationUpdate(id: "${relation.id}", input: { type: "blocks" }) { success } }`,
    );
    expect(errorCode(update)).toBe('FORBIDDEN');
    const remove = await gql(
      { cookie: reader.user.cookie },
      `mutation { issueRelationDelete(id: "${relation.id}") { success } }`,
    );
    expect(errorCode(remove)).toBe('FORBIDDEN');
    expect((await client.issueRelation(relation.id)).type).toBe('related');
  });
});
