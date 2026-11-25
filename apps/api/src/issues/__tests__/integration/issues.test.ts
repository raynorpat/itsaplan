import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  archiveIssue,
  createIssue,
  createLabel,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  updateTeam,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Issues over GraphQL: create defaults and rules, Linear's status timestamps,
// sub-issues, updates that keep the current values when refused, archive, search and
// batch updates. Reading, filters and the basic mutations are in the GraphQL
// issues-query, mutations and validation tests.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

const FIELDS =
  'id identifier number title priority sortOrder estimate startedAt completedAt canceledAt parent { id } creator { id } state { id } labelIds';

async function setupTeam() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id, col: statesByType(view) };
}

const issueCreate = (who: TestUser, input: Record<string, unknown>) =>
  gql(
    { cookie: who.cookie },
    `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${FIELDS} } } }`,
    { input },
  );
const issueUpdate = (who: TestUser, id: string, input: Record<string, unknown>) =>
  gql(
    { cookie: who.cookie },
    `mutation ($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { issue { ${FIELDS} } } }`,
    { id, input },
  );
const read = async (who: TestUser, id: string) =>
  (await gqlData(who, `{ issue(id: "${id}") { ${FIELDS} } }`)).issue;
const updated = (res: { body: { data?: unknown } }) =>
  (res.body.data as { issueUpdate: { issue: Record<string, unknown> } }).issueUpdate.issue;
const issueCount = async (who: TestUser) =>
  (await gqlData(who, '{ issues(first: 250) { nodes { id } } }')).issues.nodes.length;

describe('issues', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('defaults priority to 0 and records the creator', async () => {
      const { owner, teamId } = await setupTeam();
      const res = await issueCreate(owner, { teamId, title: 'Task' });
      expect(res.body.data).toMatchObject({
        issueCreate: { issue: { priority: 0, creator: { id: owner.userId } } },
      });
    });

    it('hands out increasing numbers and a higher sort order for a later issue', async () => {
      const { owner, teamId } = await setupTeam();
      const a = await read(owner, (await createIssue(owner, { teamId, title: 'A' })).id);
      const b = await read(owner, (await createIssue(owner, { teamId, title: 'B' })).id);
      expect(b.number).toBe(a.number + 1);
      expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    });

    it("rejects another team's label or state and creates no issue", async () => {
      const { owner, teamId } = await setupTeam();
      const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
      const label = await createLabel(owner, { teamId: ops.team.id, name: 'ops' });
      expect(code(await issueCreate(owner, { teamId, title: 'x', labelIds: [label.id] }))).toBe(
        'INVALID_INPUT',
      );
      expect(
        code(await issueCreate(owner, { teamId, title: 'x', stateId: statesByType(ops).backlog })),
      ).toBe('INVALID_INPUT');
      expect(await issueCount(owner)).toBe(0);
    });

    it('answers an unknown team with ENTITY_NOT_FOUND', async () => {
      const { owner } = await setupTeam();
      expect(code(await issueCreate(owner, { teamId: crypto.randomUUID(), title: 'x' }))).toBe(
        'ENTITY_NOT_FOUND',
      );
    });
  });

  describe('status timestamps, estimate and sub-issues', () => {
    it('sets startedAt on create in a started state', async () => {
      const { owner, teamId, col } = await setupTeam();
      const res = await issueCreate(owner, { teamId, title: 'x', stateId: col.started });
      expect(res.body.data).toMatchObject({
        issueCreate: { issue: { startedAt: expect.any(String), completedAt: null } },
      });
    });

    it('sets completedAt on completing, canceledAt on canceling, and clears them in the backlog', async () => {
      const { owner, teamId, col } = await setupTeam();
      const issue = await createIssue(owner, { teamId, stateId: col.started });
      const done = updated(await issueUpdate(owner, issue.id, { stateId: col.completed }));
      expect(done.completedAt).toBeTruthy();
      expect(done.startedAt).toBeTruthy();
      const back = updated(await issueUpdate(owner, issue.id, { stateId: col.backlog }));
      expect(back).toMatchObject({ startedAt: null, completedAt: null, canceledAt: null });
      const canceled = updated(await issueUpdate(owner, issue.id, { stateId: col.canceled }));
      expect(canceled.canceledAt).toBeTruthy();
    });

    it('stores and clears an estimate', async () => {
      const { owner, teamId } = await setupTeam();
      await updateTeam(owner, teamId, { issueEstimationType: 'fibonacci' });
      const issue = await createIssue(owner, { teamId, estimate: 3 });
      expect((await read(owner, issue.id)).estimate).toBe(3);
      expect(updated(await issueUpdate(owner, issue.id, { estimate: null })).estimate).toBeNull();
    });

    it('links a sub-issue to its parent and clears the parent with null', async () => {
      const { owner, teamId } = await setupTeam();
      const parent = await createIssue(owner, { teamId, title: 'Parent' });
      const child = await createIssue(owner, { teamId, title: 'Child', parentId: parent.id });
      expect((await read(owner, child.id)).parent).toEqual({ id: parent.id });
      expect(updated(await issueUpdate(owner, child.id, { parentId: null })).parent).toBeNull();
    });

    it('refuses a parent from another team, the issue itself and its own descendant', async () => {
      const { owner, teamId } = await setupTeam();
      const ops = (await createTeam(owner, { key: 'OPS', name: 'Ops' })).team.id;
      const foreign = await createIssue(owner, { teamId: ops, title: 'Foreign' });
      expect(code(await issueCreate(owner, { teamId, title: 'x', parentId: foreign.id }))).toBe(
        'INVALID_INPUT',
      );
      const top = await createIssue(owner, { teamId, title: 'Top' });
      const mid = await createIssue(owner, { teamId, title: 'Mid', parentId: top.id });
      const leaf = await createIssue(owner, { teamId, title: 'Leaf', parentId: mid.id });
      expect(code(await issueUpdate(owner, top.id, { parentId: top.id }))).toBe('INVALID_INPUT');
      expect(code(await issueUpdate(owner, top.id, { parentId: leaf.id }))).toBe('INVALID_INPUT');
      expect((await read(owner, top.id)).parent).toBeNull();
    });
  });

  describe('update', () => {
    it('moves, reorders and replaces labels, changing only the given fields', async () => {
      const { owner, teamId, col } = await setupTeam();
      const a = await createLabel(owner, { teamId, name: 'a' });
      const b = await createLabel(owner, { teamId, name: 'b' });
      const issue = await createIssue(owner, { teamId, title: 'Task', labelIds: [a.id] });
      const moved = updated(
        await issueUpdate(owner, issue.id, {
          stateId: col.started,
          sortOrder: 42,
          labelIds: [b.id],
        }),
      );
      expect(moved).toMatchObject({
        title: 'Task',
        state: { id: col.started },
        sortOrder: 42,
        labelIds: [b.id],
      });
    });

    it("refuses another team's state and keeps the current one; refuses an empty title", async () => {
      const { owner, teamId } = await setupTeam();
      const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
      const issue = await createIssue(owner, { teamId });
      const before = (await read(owner, issue.id)).state.id;
      expect(code(await issueUpdate(owner, issue.id, { stateId: statesByType(ops).backlog }))).toBe(
        'INVALID_INPUT',
      );
      expect(code(await issueUpdate(owner, issue.id, { title: '' }))).toBe('INVALID_INPUT');
      expect((await read(owner, issue.id)).state.id).toBe(before);
    });

    it('answers a missing issue with ENTITY_NOT_FOUND on update, delete and archive', async () => {
      const { owner } = await setupTeam();
      const missing = crypto.randomUUID();
      expect(code(await issueUpdate(owner, missing, { title: 'x' }))).toBe('ENTITY_NOT_FOUND');
      for (const op of ['issueDelete', 'issueArchive'])
        expect(
          code(
            await gql({ cookie: owner.cookie }, `mutation { ${op}(id: "${missing}") { success } }`),
          ),
        ).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('archive', () => {
    it('logs an archived entry and reads an archived issue by identifier', async () => {
      const { owner, teamId } = await setupTeam();
      const issue = await createIssue(owner, { teamId });
      await archiveIssue(owner, issue.id);
      const history = await gqlData(
        owner,
        `{ issue(id: "${issue.identifier}") { archivedAt history { nodes { archived } } } }`,
      );
      expect(history.issue.archivedAt).toBeTruthy();
      expect(
        history.issue.history.nodes.some((n: { archived: boolean | null }) => n.archived),
      ).toBe(true);
    });

    it('refuses archiving to a guest outside the team', async () => {
      const { owner, teamId } = await setupTeam();
      const issue = await createIssue(owner, { teamId });
      const guest = await signUpAs('guest');
      const res = await gql(
        { cookie: guest.cookie },
        `mutation { issueArchive(id: "${issue.id}") { success } }`,
      );
      expect(code(res)).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('search', () => {
    const search = async (who: TestUser, term: string, extra = '') =>
      (
        await gqlData(
          who,
          `query ($term: String!) { searchIssues(term: $term${extra}) { nodes { id identifier archivedAt } } }`,
          { term },
        )
      ).searchIssues.nodes as { id: string; identifier: string; archivedAt: string | null }[];

    it('matches title and description, and archived issues with includeArchived', async () => {
      const { owner, teamId } = await setupTeam();
      const byTitle = await createIssue(owner, { teamId, title: 'Zephyr rollout' });
      const byDescription = await createIssue(owner, {
        teamId,
        title: 'Plain',
        description: 'contains quokka word',
      });
      await createIssue(owner, { teamId, title: 'Unrelated' });
      expect((await search(owner, 'zephyr')).map((i) => i.id)).toEqual([byTitle.id]);
      expect((await search(owner, 'quokka')).map((i) => i.id)).toEqual([byDescription.id]);
      await archiveIssue(owner, byTitle.id);
      const archived = await search(owner, 'zephyr', ', includeArchived: true');
      expect(archived.map((i) => i.id)).toEqual([byTitle.id]);
      expect(archived[0]!.archivedAt).toBeTruthy();
    });

    it('caps the count with first and matches LIKE metacharacters literally', async () => {
      const { owner, teamId } = await setupTeam();
      for (let i = 0; i < 3; i++) await createIssue(owner, { teamId, title: `Item ${i}` });
      expect(await search(owner, 'item', ', first: 2')).toHaveLength(2);
      const hit = await createIssue(owner, { teamId, title: '50% off deal' });
      await createIssue(owner, { teamId, title: 'no discount' });
      expect((await search(owner, '50%')).map((i) => i.id)).toEqual([hit.id]);
    });

    it('scopes to a team and finds nothing in a team the viewer cannot see', async () => {
      const { owner, teamId } = await setupTeam();
      await createIssue(owner, { teamId, title: 'Kestrel here' });
      const ops = (await createTeam(owner, { key: 'OPS', name: 'Ops' })).team.id;
      await createIssue(owner, { teamId: ops, title: 'Kestrel there' });
      const scoped = await search(owner, 'kestrel', ', teamId: "MKT"');
      expect(scoped.map((i) => i.identifier)).toEqual(['MKT-1']);
      expect(await search(await signUpAs('guest'), 'kestrel')).toEqual([]);
    });
  });

  describe('batch updates', () => {
    it('applies one patch to every listed issue', async () => {
      const { owner, teamId, col } = await setupTeam();
      const a = await createIssue(owner, { teamId });
      const b = await createIssue(owner, { teamId });
      await gqlData(
        owner,
        `mutation { issueBatchUpdate(ids: ["${a.id}", "${b.id}"], input: { stateId: "${col.started}", priority: 1 }) { success } }`,
      );
      for (const id of [a.id, b.id])
        expect(await read(owner, id)).toMatchObject({ state: { id: col.started }, priority: 1 });
    });

    it("refuses another team's state or label and changes nothing", async () => {
      const { owner, teamId } = await setupTeam();
      const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
      const label = await createLabel(owner, { teamId: ops.team.id, name: 'ops' });
      const a = await createIssue(owner, { teamId });
      const before = (await read(owner, a.id)).state.id;
      for (const input of [
        `stateId: "${statesByType(ops).backlog}"`,
        `addedLabelIds: ["${label.id}"]`,
      ]) {
        const res = await gql(
          { cookie: owner.cookie },
          `mutation { issueBatchUpdate(ids: ["${a.id}"], input: { ${input} }) { success } }`,
        );
        expect(code(res)).toBe('INVALID_INPUT');
      }
      expect(await read(owner, a.id)).toMatchObject({ state: { id: before }, labelIds: [] });
    });

    it('refuses an empty id list', async () => {
      const { owner } = await setupTeam();
      const res = await gql(
        { cookie: owner.cookie },
        'mutation { issueBatchUpdate(ids: [], input: { priority: 1 }) { success } }',
      );
      expect(code(res)).toBe('INVALID_INPUT');
    });
  });
});
