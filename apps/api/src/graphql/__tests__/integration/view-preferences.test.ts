import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';

// Personal view preferences per view type (Linear's userViewPreferences): one record
// per user and list kind (allIssues, project, cycle, myIssues), without a saved view.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CREATE = `mutation($input: ViewPreferencesCreateInput!) {
  viewPreferencesCreate(input: $input) { success viewPreferences { id type viewType preferences { layout issueGrouping } } }
}`;
const READ = `query($viewType: ViewType!) {
  userViewPreferences(viewType: $viewType) { id type viewType preferences { layout issueGrouping } }
}`;

describe('graphql personal view preferences per view type', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a record and reads it back; a second create updates the same record', async () => {
    const a = await signUpTestUser({ name: 'A' });
    const none = await gql({ cookie: a.cookie }, READ, { viewType: 'allIssues' });
    expect(none.body.errors).toBeUndefined();
    expect((none.body.data as Data).userViewPreferences).toBeNull();

    const first = await gql({ cookie: a.cookie }, CREATE, {
      input: { type: 'user', viewType: 'allIssues', preferences: { layout: 'board' } },
    });
    expect(first.body.errors).toBeUndefined();
    const created = (first.body.data as Data).viewPreferencesCreate.viewPreferences;
    expect(created).toMatchObject({ type: 'user', viewType: 'allIssues' });
    expect(created.preferences.layout).toBe('board');

    const second = await gql({ cookie: a.cookie }, CREATE, {
      input: {
        type: 'user',
        viewType: 'allIssues',
        preferences: { layout: 'list', issueGrouping: 'priority' },
      },
    });
    expect(second.body.errors).toBeUndefined();
    expect((second.body.data as Data).viewPreferencesCreate.viewPreferences.id).toBe(created.id);

    const read = await gql({ cookie: a.cookie }, READ, { viewType: 'allIssues' });
    expect((read.body.data as Data).userViewPreferences).toMatchObject({
      id: created.id,
      preferences: { layout: 'list', issueGrouping: 'priority' },
    });

    // Another view type is a separate record.
    const project = await gql({ cookie: a.cookie }, READ, { viewType: 'project' });
    expect((project.body.data as Data).userViewPreferences).toBeNull();
  });

  it("keeps one user's record from another", async () => {
    const a = await signUpTestUser({ name: 'A' });
    const b = await signUpTestUser({ name: 'B' });
    const res = await gql({ cookie: a.cookie }, CREATE, {
      input: { type: 'user', viewType: 'cycle', preferences: { layout: 'board' } },
    });
    const id = (res.body.data as Data).viewPreferencesCreate.viewPreferences.id;

    const bRead = await gql({ cookie: b.cookie }, READ, { viewType: 'cycle' });
    expect((bRead.body.data as Data).userViewPreferences).toBeNull();

    const bUpdate = await gql(
      { cookie: b.cookie },
      `mutation { viewPreferencesUpdate(id: "${id}", input: { preferences: { layout: "list" } }) { success } }`,
    );
    expect(errorCode(bUpdate)).toBe('ENTITY_NOT_FOUND');
    const bDelete = await gql(
      { cookie: b.cookie },
      `mutation { viewPreferencesDelete(id: "${id}") { success } }`,
    );
    expect(errorCode(bDelete)).toBe('ENTITY_NOT_FOUND');

    // B's own record does not touch A's.
    await gql({ cookie: b.cookie }, CREATE, {
      input: { type: 'user', viewType: 'cycle', preferences: { layout: 'list' } },
    });
    const aRead = await gql({ cookie: a.cookie }, READ, { viewType: 'cycle' });
    expect((aRead.body.data as Data).userViewPreferences.preferences.layout).toBe('board');
  });

  it('lets the owner update and delete the record', async () => {
    const a = await signUpTestUser({ name: 'A' });
    const res = await gql({ cookie: a.cookie }, CREATE, {
      input: { type: 'user', viewType: 'myIssues', preferences: { layout: 'list' } },
    });
    const id = (res.body.data as Data).viewPreferencesCreate.viewPreferences.id;
    const upd = await gql(
      { cookie: a.cookie },
      `mutation { viewPreferencesUpdate(id: "${id}", input: { preferences: { issueGrouping: "priority" } }) { viewPreferences { preferences { issueGrouping } } } }`,
    );
    expect(upd.body.errors).toBeUndefined();
    expect(
      (upd.body.data as Data).viewPreferencesUpdate.viewPreferences.preferences.issueGrouping,
    ).toBe('priority');
    const del = await gql(
      { cookie: a.cookie },
      `mutation { viewPreferencesDelete(id: "${id}") { success } }`,
    );
    expect(del.body.errors).toBeUndefined();
    const read = await gql({ cookie: a.cookie }, READ, { viewType: 'myIssues' });
    expect((read.body.data as Data).userViewPreferences).toBeNull();
  });

  it('refuses other view types and organization records without a saved view', async () => {
    const a = await signUpTestUser({ name: 'A' });
    const inbox = await gql({ cookie: a.cookie }, CREATE, {
      input: { type: 'user', viewType: 'inbox', preferences: {} },
    });
    expect(errorCode(inbox)).toBe('INVALID_INPUT');
    const org = await gql({ cookie: a.cookie }, CREATE, {
      input: { type: 'organization', viewType: 'allIssues', preferences: {} },
    });
    expect(errorCode(org)).toBe('INVALID_INPUT');
    const read = await gql({ cookie: a.cookie }, READ, { viewType: 'inbox' });
    expect(errorCode(read)).toBe('INVALID_INPUT');
  });
});
