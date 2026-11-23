import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { addToTeam, signUpWithRole } from '../../../__tests__/helpers/roles';

// Linear's CustomView over the saved team views: CRUD with Linear's filterData,
// creator and owner, view preferences for the layout, visibility through the team,
// and the team requirement.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const mkt = (await asOwner.teams.post({ key: 'MKT', name: 'Marketing' })).data!;
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const run = async (cookie: string, query: string, variables?: Record<string, unknown>) =>
    gql({ cookie }, query, variables);
  return { owner, asOwner, mktId: mkt.id, run };
}

const CREATE = `mutation($input: CustomViewCreateInput!) {
  customViewCreate(input: $input) { success customView { id name filterData slugId shared team { id } creator { id } owner { id } } }
}`;

describe('graphql custom views', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("filters views by their team's key", async () => {
    const { owner, mktId, run } = await setup();
    await run(owner.cookie, CREATE, { input: { name: 'Mkt', teamId: mktId } });
    await run(owner.cookie, CREATE, { input: { name: 'Ops', teamId: 'OPS' } });
    const list = await run(
      owner.cookie,
      '{ customViews(filter: { team: { key: { eq: "OPS" } } }) { nodes { name } } }',
    );
    expect(list.body.errors).toBeUndefined();
    expect((list.body.data as Data).customViews.nodes).toEqual([{ name: 'Ops' }]);
  });

  it('creates, reads, updates and deletes a team view', async () => {
    const { owner, mktId, run } = await setup();
    const filterData = { and: [{ priority: { in: [1, 2] } }] };
    const created = await run(owner.cookie, CREATE, {
      input: { name: 'Urgent', teamId: mktId, filterData },
    });
    expect(created.body.errors).toBeUndefined();
    const view = (created.body.data as Data).customViewCreate.customView;
    expect(view).toMatchObject({
      name: 'Urgent',
      filterData,
      shared: true,
      team: { id: mktId },
      creator: { id: owner.userId },
      owner: { id: owner.userId },
    });
    expect(view.slugId).toBeTruthy();

    const list = await run(owner.cookie, '{ customViews { nodes { id name } } }');
    expect((list.body.data as Data).customViews.nodes).toEqual([{ id: view.id, name: 'Urgent' }]);
    const one = await run(owner.cookie, `{ customView(id: "${view.id}") { id filterData } }`);
    expect((one.body.data as Data).customView).toEqual({ id: view.id, filterData });

    const updated = await run(
      owner.cookie,
      `mutation { customViewUpdate(id: "${view.id}", input: { name: "Hot", filterData: { priority: { eq: 1 } } }) { customView { name filterData updatedBy { id } } } }`,
    );
    expect((updated.body.data as Data).customViewUpdate.customView).toEqual({
      name: 'Hot',
      filterData: { priority: { eq: 1 } },
      updatedBy: { id: owner.userId },
    });

    const deleted = await run(
      owner.cookie,
      `mutation { customViewDelete(id: "${view.id}") { success } }`,
    );
    expect((deleted.body.data as Data).customViewDelete.success).toBe(true);
    const gone = await run(owner.cookie, `{ customView(id: "${view.id}") { id } }`);
    expect(errorCode(gone)).toBe('ENTITY_NOT_FOUND');
  });

  it('stores view preferences', async () => {
    const { owner, mktId, run } = await setup();
    const created = await run(owner.cookie, CREATE, { input: { name: 'Board', teamId: mktId } });
    const viewId = (created.body.data as Data).customViewCreate.customView.id;
    const prefs = await run(
      owner.cookie,
      `mutation($input: ViewPreferencesCreateInput!) { viewPreferencesCreate(input: $input) { success viewPreferences { id type viewType preferences { layout } } } }`,
      {
        input: {
          type: 'organization',
          viewType: 'customView',
          customViewId: viewId,
          preferences: { layout: 'table', grouping: 'status' },
        },
      },
    );
    expect(prefs.body.errors).toBeUndefined();
    const vp = (prefs.body.data as Data).viewPreferencesCreate.viewPreferences;
    expect(vp).toMatchObject({
      type: 'organization',
      viewType: 'customView',
      preferences: { layout: 'table' },
    });

    const read = await run(
      owner.cookie,
      `{ customView(id: "${viewId}") { viewPreferencesValues { layout } organizationViewPreferences { id } } }`,
    );
    expect((read.body.data as Data).customView).toEqual({
      viewPreferencesValues: { layout: 'table' },
      organizationViewPreferences: { id: vp.id },
    });

    const upd = await run(
      owner.cookie,
      `mutation { viewPreferencesUpdate(id: "${vp.id}", input: { preferences: { layout: "kanban" } }) { viewPreferences { preferences { layout } } } }`,
    );
    expect((upd.body.data as Data).viewPreferencesUpdate.viewPreferences.preferences.layout).toBe(
      'kanban',
    );
  });

  it('hides views of teams the viewer cannot see', async () => {
    const { owner, asOwner, mktId, run } = await setup();
    const created = await run(owner.cookie, CREATE, { input: { name: 'Mine', teamId: mktId } });
    const viewId = (created.body.data as Data).customViewCreate.customView.id;
    const guest = await signUpWithRole('guest');
    const ops = await signUpTestUser();
    await addToTeam(asOwner, 'OPS', guest);
    void ops;
    for (const q of [
      `{ customView(id: "${viewId}") { id } }`,
      `mutation { customViewUpdate(id: "${viewId}", input: { name: "x" }) { success } }`,
      `mutation { customViewDelete(id: "${viewId}") { success } }`,
    ])
      expect(errorCode(await run(guest.cookie, q))).toBe('ENTITY_NOT_FOUND');
    const list = await run(guest.cookie, '{ customViews { nodes { id } } }');
    expect((list.body.data as Data).customViews.nodes).toEqual([]);
  });

  it('rejects a view without a team', async () => {
    const { owner, run } = await setup();
    const res = await run(owner.cookie, CREATE, { input: { name: 'Nowhere' } });
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it("lists a view's issues by its filter, labels included", async () => {
    const { owner, asOwner, mktId, run } = await setup();
    const view = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
    const stateId = view.states[0]!.id;
    const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'Bug' })).data!;
    await asOwner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId, title: 'Labelled', labelIds: [label.id] } as never);
    await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Plain' });
    const created = await run(owner.cookie, CREATE, {
      input: {
        name: 'Bugs',
        teamId: mktId,
        filterData: { and: [{ labels: { some: { id: { in: [label.id] } } } }] },
      },
    });
    const viewId = (created.body.data as Data).customViewCreate.customView.id;
    const issues = await run(
      owner.cookie,
      `{ customView(id: "${viewId}") { issues { nodes { title } } } }`,
    );
    expect(issues.body.errors).toBeUndefined();
    expect((issues.body.data as Data).customView.issues.nodes).toEqual([{ title: 'Labelled' }]);
    const none = await run(
      owner.cookie,
      '{ issues(filter: { labels: { length: { eq: 0 } } }) { nodes { title } } }',
    );
    expect((none.body.data as Data).issues.nodes).toEqual([{ title: 'Plain' }]);
  });
});
