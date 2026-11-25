import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createDocument,
  createIssue,
  createLabel,
  createProject,
  createTeam,
  createView,
  gqlData,
  makePrivate,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { instance, ok } from '../../../portal/__tests__/helpers';

// Linear's Favorite: a person's own sidebar bookmarks and folders, each favorite
// pointing at one item the person can see.

const FIELDS = `id type folderName sortOrder url predefinedViewType
  parent { id } owner { id }
  issue { id title } project { id } customView { id } cycle { id } document { id }
  label { id } projectLabel { id } customer { id } team { id }
  user { id } predefinedViewTeam { id }`;

const CREATE = `mutation($input: FavoriteCreateInput!) {
  favoriteCreate(input: $input) { success favorite { ${FIELDS} } }
}`;
const UPDATE = `mutation($id: String!, $input: FavoriteUpdateInput!) {
  favoriteUpdate(id: $id, input: $input) { success favorite { ${FIELDS} } }
}`;
const DELETE = `mutation($id: String!) { favoriteDelete(id: $id) { success entityId } }`;
const LIST = `{ favorites(first: 250) { nodes { ${FIELDS} children { nodes { id } } } } }`;
const ONE = `query($id: String!) { favorite(id: $id) { ${FIELDS} } }`;

type Fav = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const create = async (as: TestUser, input: Record<string, unknown>): Promise<Fav> =>
  (await gqlData(as, CREATE, { input })).favoriteCreate.favorite;

const list = async (as: TestUser): Promise<Fav[]> => (await gqlData(as, LIST)).favorites.nodes;

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code as string | undefined;
}

async function errorMessage(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.message as string | undefined;
}

async function setup() {
  const owner = await signUpTestUser();
  const eng = (await createTeam(owner, { key: 'ENG' })).team;
  const issue = await createIssue(owner, { teamId: eng.id, title: 'Fix login' });
  return { owner, eng, issue };
}

describe('favorites', () => {
  beforeEach(resetDb);

  it('a member favorites an issue and lists it', async () => {
    const { owner, eng } = await setup();
    const member = await signUpAs('member');
    const issue = await createIssue(owner, { teamId: eng.id, title: 'Dark mode' });
    const fav = await create(member, { issueId: issue.id });
    expect(fav.type).toBe('issue');
    expect(fav.issue).toEqual({ id: issue.id, title: 'Dark mode' });
    expect(fav.owner.id).toBe(member.userId);
    expect(fav.url).toEndWith(`/team/ENG/issue/${issue.number}`);
    expect((await list(member)).map((f) => f.id)).toEqual([fav.id]);
    expect(await list(owner)).toEqual([]);
  });

  it('favoriting the same issue twice returns the same favorite', async () => {
    const { owner, issue } = await setup();
    const a = await create(owner, { issueId: issue.id });
    const b = await create(owner, { issueId: issue.id });
    expect(b.id).toBe(a.id);
    expect(await list(owner)).toHaveLength(1);
  });

  it('two concurrent creates give one favorite', async () => {
    const { owner, issue } = await setup();
    const [a, b] = await Promise.all([
      create(owner, { issueId: issue.id }),
      create(owner, { issueId: issue.id }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await list(owner)).toHaveLength(1);
  });

  it('each supported kind can be favorited', async () => {
    const { owner, eng } = await setup();
    await ok(await instance('customers-settings/save', owner, { enabled: true }));
    const project = await createProject(owner, { name: 'Launch', teamIds: [eng.id] });
    const view = await createView(owner, { name: 'Bugs', teamId: eng.id, shared: true });
    const doc = await createDocument(owner, { title: 'Spec', projectId: project.id });
    const label = await createLabel(owner, { name: 'Bug', teamId: eng.id });
    const projectLabel = (
      await gqlData(
        owner,
        `mutation { projectLabelCreate(input: { name: "Big" }) { projectLabel { id } } }`,
      )
    ).projectLabelCreate.projectLabel;
    const customer = (
      await gqlData(
        owner,
        `mutation { customerCreate(input: { name: "Acme" }) { customer { id } } }`,
      )
    ).customerCreate.customer;
    const dashboard = (
      await ok(
        await instance('dashboards/create', owner, {
          name: 'Mine',
          sharedWith: 'workspace',
          widgets: [],
        }),
      )
    ).dashboard;
    const cycle = (
      await gqlData(
        owner,
        `mutation($id: String!) { teamUpdate(id: $id, input: { cyclesEnabled: true }) { team { activeCycle { id } } } }`,
        { id: eng.id },
      )
    ).teamUpdate.team.activeCycle;
    const member = await signUpAs('member');

    const cases: [Record<string, unknown>, string, string, string | null][] = [
      [{ projectId: project.id }, 'project', 'project', project.id],
      [{ customViewId: view.id }, 'customView', 'customView', view.id],
      [{ documentId: doc.id }, 'document', 'document', doc.id],
      [{ labelId: label.id }, 'label', 'label', label.id],
      [{ projectLabelId: projectLabel.id }, 'projectLabel', 'projectLabel', projectLabel.id],
      [{ customerId: customer.id }, 'customer', 'customer', customer.id],
      [{ teamId: eng.id }, 'team', 'team', eng.id],
      [{ userId: member.userId }, 'user', 'user', member.userId],
      [{ predefinedViewType: 'myIssues' }, 'predefinedView', 'predefinedViewTeam', null],
    ];
    if (cycle) cases.push([{ cycleId: cycle.id }, 'cycle', 'cycle', cycle.id]);
    for (const [input, type, field, id] of cases) {
      const fav = await create(owner, input);
      expect(fav.type).toBe(type);
      expect(fav[field]?.id ?? null).toBe(id);
    }
    const dash = await create(owner, { dashboardId: dashboard.id });
    expect(dash.type).toBe('dashboard');
    expect(dash.url).toEndWith(`/dashboards/${dashboard.id}`);
    const teamView = await create(owner, {
      predefinedViewType: 'activeCycle',
      predefinedViewTeamId: eng.id,
    });
    expect(teamView.predefinedViewType).toBe('activeCycle');
    expect(teamView.predefinedViewTeam.id).toBe(eng.id);
    expect(await list(owner)).toHaveLength(cases.length + 2);
  });

  it('exactly one target is required', async () => {
    const { owner, eng, issue } = await setup();
    expect(await errorCode(owner, CREATE, { input: {} })).toBe('INVALID_INPUT');
    expect(await errorCode(owner, CREATE, { input: { issueId: issue.id, teamId: eng.id } })).toBe(
      'INVALID_INPUT',
    );
    expect(
      await errorCode(owner, CREATE, {
        input: { releaseId: '00000000-0000-4000-8000-000000000000' },
      }),
    ).toBe('INVALID_INPUT');
    expect(await errorCode(owner, CREATE, { input: { issueId: 'nope' } })).toBe('INVALID_INPUT');
  });

  it('folders hold favorites and cannot be nested', async () => {
    const { owner, issue } = await setup();
    const folder = await create(owner, { folderName: 'Work' });
    expect(folder.type).toBe('folder');
    expect(folder.url).toBeNull();
    const fav = await create(owner, { issueId: issue.id, parentId: folder.id });
    expect(fav.parent.id).toBe(folder.id);
    const rows = await list(owner);
    expect(rows.find((r) => r.id === folder.id)!.children.nodes.map((c: Fav) => c.id)).toEqual([
      fav.id,
    ]);
    expect(
      await errorMessage(owner, CREATE, { input: { folderName: 'Inner', parentId: folder.id } }),
    ).toBe('Folders cannot be nested');
    expect(await errorCode(owner, UPDATE, { id: folder.id, input: { parentId: folder.id } })).toBe(
      'INVALID_INPUT',
    );
    // The parent must be a folder.
    const team = await create(owner, { predefinedViewType: 'myIssues' });
    expect(await errorCode(owner, UPDATE, { id: team.id, input: { parentId: fav.id } })).toBe(
      'INVALID_INPUT',
    );
  });

  it('deleting a folder deletes its favorites, as in Linear', async () => {
    const { owner, issue } = await setup();
    const folder = await create(owner, { folderName: 'Work' });
    await create(owner, { issueId: issue.id, parentId: folder.id });
    const res = await gqlData(owner, DELETE, { id: folder.id });
    expect(res.favoriteDelete).toEqual({ success: true, entityId: folder.id });
    expect(await list(owner)).toEqual([]);
  });

  it('a folder is renamed, and favorites move into and out of it', async () => {
    const { owner, issue } = await setup();
    const folder = await create(owner, { folderName: 'Work' });
    const renamed = (await gqlData(owner, UPDATE, { id: folder.id, input: { folderName: 'Now' } }))
      .favoriteUpdate.favorite;
    expect(renamed.folderName).toBe('Now');
    const fav = await create(owner, { issueId: issue.id });
    const inside = (await gqlData(owner, UPDATE, { id: fav.id, input: { parentId: folder.id } }))
      .favoriteUpdate.favorite;
    expect(inside.parent.id).toBe(folder.id);
    const outside = (await gqlData(owner, UPDATE, { id: fav.id, input: { parentId: null } }))
      .favoriteUpdate.favorite;
    expect(outside.parent).toBeNull();
    expect(
      await errorCode(owner, UPDATE, { id: fav.id, input: { folderName: 'Not a folder' } }),
    ).toBe('INVALID_INPUT');
  });

  it("another person's favorite is not found", async () => {
    const { owner, issue } = await setup();
    const fav = await create(owner, { issueId: issue.id });
    const member = await signUpAs('member');
    expect(await errorCode(member, ONE, { id: fav.id })).toBe('ENTITY_NOT_FOUND');
    expect(await errorCode(member, UPDATE, { id: fav.id, input: { sortOrder: 5 } })).toBe(
      'ENTITY_NOT_FOUND',
    );
    // Linear: a delete succeeds when the favorite no longer exists; another person's
    // favorite does not exist for the caller and stays.
    expect((await gqlData(member, DELETE, { id: fav.id })).favoriteDelete.success).toBe(true);
    expect(await list(member)).toEqual([]);
    expect(await list(owner)).toHaveLength(1);
  });

  it('a favorite of an issue in a team made private is left out', async () => {
    const { owner, eng, issue } = await setup();
    const member = await signUpAs('member');
    const fav = await create(member, { issueId: issue.id });
    await makePrivate(owner, eng.id);
    expect(await list(member)).toEqual([]);
    const one = (await gqlData(member, ONE, { id: fav.id })).favorite;
    expect(one.issue).toBeNull();
    expect(one.url).toBeNull();
  });

  it('a favorite of an archived issue or a trashed project is left out', async () => {
    const { owner, eng, issue } = await setup();
    const project = await createProject(owner, { name: 'Launch', teamIds: [eng.id] });
    await create(owner, { issueId: issue.id });
    await create(owner, { projectId: project.id });
    await gqlData(owner, `mutation($id: String!) { issueArchive(id: $id) { success } }`, {
      id: issue.id,
    });
    await gqlData(owner, `mutation($id: String!) { projectDelete(id: $id) { success } }`, {
      id: project.id,
    });
    expect(await list(owner)).toEqual([]);
  });

  it('a guest does not see a favorite of a team they left', async () => {
    const { owner, eng, issue } = await setup();
    const guest = await signUpAs('guest');
    const membership = (
      await gqlData(
        owner,
        `mutation($t: String!, $u: String!) { teamMembershipCreate(input: { teamId: $t, userId: $u }) { teamMembership { id } } }`,
        { t: eng.id, u: guest.userId },
      )
    ).teamMembershipCreate.teamMembership;
    await create(guest, { issueId: issue.id });
    expect(await list(guest)).toHaveLength(1);
    await gqlData(owner, `mutation($id: String!) { teamMembershipDelete(id: $id) { success } }`, {
      id: membership.id,
    });
    expect(await list(guest)).toEqual([]);
  });

  it('deleting the issue deletes its favorite', async () => {
    const { owner, issue } = await setup();
    const fav = await create(owner, { issueId: issue.id });
    await gqlData(
      owner,
      `mutation($id: String!) { issueDelete(id: $id, permanentlyDelete: true) { success } }`,
      {
        id: issue.id,
      },
    );
    expect(await list(owner)).toEqual([]);
    expect(await errorCode(owner, ONE, { id: fav.id })).toBe('ENTITY_NOT_FOUND');
  });

  it('customer favorites are left out while Customers is off', async () => {
    const { owner } = await setup();
    await ok(await instance('customers-settings/save', owner, { enabled: true }));
    const customer = (
      await gqlData(
        owner,
        `mutation { customerCreate(input: { name: "Acme" }) { customer { id } } }`,
      )
    ).customerCreate.customer;
    await create(owner, { customerId: customer.id });
    expect(await list(owner)).toHaveLength(1);
    await ok(await instance('customers-settings/save', owner, { enabled: false }));
    expect(await list(owner)).toEqual([]);
  });

  it('new favorites go last; favoriteUpdate sortOrder reorders', async () => {
    const { owner, eng, issue } = await setup();
    const second = await createIssue(owner, { teamId: eng.id, title: 'Second' });
    const a = await create(owner, { issueId: issue.id });
    const b = await create(owner, { issueId: second.id });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    const moved = (
      await gqlData(owner, UPDATE, { id: b.id, input: { sortOrder: a.sortOrder - 500 } })
    ).favoriteUpdate.favorite;
    expect(moved.sortOrder).toBe(a.sortOrder - 500);
  });

  it('favoriteCreate for an existing favorite moves it to the given folder', async () => {
    const { owner, issue } = await setup();
    const folder = await create(owner, { folderName: 'Work' });
    const fav = await create(owner, { issueId: issue.id });
    const again = await create(owner, { issueId: issue.id, parentId: folder.id, sortOrder: 7 });
    expect(again.id).toBe(fav.id);
    expect(again.parent.id).toBe(folder.id);
    expect(again.sortOrder).toBe(7);
  });
});
