import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Saved views are the tabs above a team's work items view. List and create are
// team-scoped (/teams/:teamKey/views), but patch and delete address a view by its own id (/views/:viewId) and resolve the
// owning team through the savedView guard. filters/display are jsonb blobs the
// store keeps verbatim; icon is nullable; tabs are ordered by creation.

async function setupOwnerTeam() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const team = await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner, teamId: team.data!.id };
}

describe('views', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create and list', () => {
    it('creates a view with default icon/filters/display and lists it', async () => {
      const { asOwner, teamId } = await setupOwnerTeam();

      const created = await asOwner.teams({ teamKey: 'MKT' }).views.post({
        name: 'My issues',
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'My issues',
        teamId,
        icon: null,
        filters: {},
        display: {},
      });
      expect(typeof created.data?.id).toBe('string');

      const list = await asOwner.teams({ teamKey: 'MKT' }).views.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0]).toMatchObject({ name: 'My issues' });
    });

    it('stores icon, filters and display verbatim', async () => {
      const { asOwner } = await setupOwnerTeam();
      const filters = { state: ['backlog'], assignee: [7] };
      const display = { group_by: 'state', order_by: '-created_at' };

      const created = await asOwner.teams({ teamKey: 'MKT' }).views.post({
        name: 'Backlog',
        icon: 'inbox',
        filters,
        display,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ icon: 'inbox', filters, display });
    });

    it('lists views in creation order', async () => {
      const { asOwner } = await setupOwnerTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' }).views;
      const a = (await scope.post({ name: 'A' })).data!;
      const b = (await scope.post({ name: 'B' })).data!;
      const c = (await scope.post({ name: 'C' })).data!;

      const list = await scope.get();
      expect(list.data?.map((v) => v.id)).toEqual([a.id, b.id, c.id]);
    });
  });

  describe('update', () => {
    it('updates only the provided fields, replacing filters/display wholesale', async () => {
      const { asOwner } = await setupOwnerTeam();
      const created = await asOwner.teams({ teamKey: 'MKT' }).views.post({
        name: 'Original',
        filters: { keep: true },
        display: { keep: true },
      });
      const id = created.data!.id;

      const patchedName = await asOwner.views({ viewId: id }).patch({ name: 'Renamed' });
      expect(patchedName.status).toBe(200);
      expect(patchedName.data).toMatchObject({
        name: 'Renamed',
        filters: { keep: true },
        display: { keep: true },
      });

      const patchedFilters = await asOwner
        .views({ viewId: id })
        .patch({ filters: { replaced: true } });
      expect(patchedFilters.status).toBe(200);
      expect(patchedFilters.data).toMatchObject({
        name: 'Renamed',
        filters: { replaced: true },
      });
    });

    it('sets and clears the icon', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'V', icon: 'star' }))
        .data!.id;

      const cleared = await asOwner.views({ viewId: id }).patch({ icon: null });
      expect(cleared.status).toBe(200);
      expect(cleared.data).toMatchObject({ icon: null });

      const set = await asOwner.views({ viewId: id }).patch({ icon: 'flag' });
      expect(set.data).toMatchObject({ icon: 'flag' });
    });

    it('returns the current view for an empty patch', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'V' })).data!.id;

      const patched = await asOwner.views({ viewId: id }).patch({});
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ id, name: 'V' });
    });

    it('returns 404 when patching a missing view', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner
        .views({ viewId: '00000000-0000-4000-8000-000000000000' })
        .patch({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('rejects a patch that sets an empty name', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'V' })).data!.id;
      const res = await asOwner.views({ viewId: id }).patch({ name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes a view', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'Gone' })).data!.id;

      const del = await asOwner.views({ viewId: id }).delete();
      expect(del.status).toBe(204);

      const list = await asOwner.teams({ teamKey: 'MKT' }).views.get();
      expect(list.data).toHaveLength(0);
    });

    it('returns 404 when deleting a missing view', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.views({ viewId: '00000000-0000-4000-8000-000000000000' }).delete();
      expect(res.status).toBe(404);
    });
  });

  describe('validation', () => {
    it('rejects a view with an empty name', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric view id', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.views({ viewId: 'abc' }).patch({ name: 'Nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).views.get();
      expect(res.status).toBe(404);
    });

    it('denies a non-member on team-scoped and entity routes', async () => {
      const { asOwner } = await setupOwnerTeam();
      const viewId = (await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'Secret' })).data!
        .id;

      const outsider = (await signUpWithRole('guest')).api;

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status (typed number) rather than error.status.
      const list = await outsider.teams({ teamKey: 'MKT' }).views.get();
      expect(list.status).toBe(404);

      const create = await outsider.teams({ teamKey: 'MKT' }).views.post({ name: 'Intruder' });
      expect(create.status).toBe(404);

      const patch = await outsider.views({ viewId }).patch({ name: 'Hacked' });
      expect(patch.status).toBe(404);

      const del = await outsider.views({ viewId }).delete();
      expect(del.status).toBe(404);
    });
  });

  it('loads a view whose filter names removed fields', async () => {
    const { asOwner } = await setupOwnerTeam();
    const filters = {
      conditions: [
        { field: 'type', op: 'is', values: [crypto.randomUUID()] },
        { field: `cf:${crypto.randomUUID()}`, op: 'is_set', values: [] },
      ],
    };
    const created = await asOwner.teams({ teamKey: 'MKT' }).views.post({ name: 'Old', filters });
    expect(created.status).toBe(201);
    const list = await asOwner.teams({ teamKey: 'MKT' }).views.get();
    expect(list.status).toBe(200);
    expect(list.data?.[0]).toMatchObject({ name: 'Old', filters });
  });
});
