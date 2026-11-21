import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Labels and label groups belong to one team. There are no GET routes — both
// are read back through the team view (GET /teams/:teamKey), whose
// `labels` and `labelGroups` fields are listLabels()/listLabelGroups() ordered by
// name. A new team seeds neither, so both lists start empty. Names are unique
// within a team (UNIQUE (team_id, name) on each table → 409 on a duplicate).
// A label may belong to at most one group; deleting the group ungroups its labels
// (label.group_id -> SET NULL).

async function setupTeam() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner };
}

// The team's labels in name order.
async function labelsOf(client: Api, teamKey = 'MKT') {
  const view = await client.teams({ teamKey }).get();
  return view.data!.labels;
}

// The team's label groups in name order.
async function groupsOf(client: Api, teamKey = 'MKT') {
  const view = await client.teams({ teamKey }).get();
  return view.data!.labelGroups;
}

describe('labels', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create label', () => {
    it('creates a label with a default color and lists it in the view', async () => {
      const { asOwner } = await setupTeam();

      const created = await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'urgent',
        color: '#6b7280',
        groupId: null,
      });
      expect(typeof created.data?.id).toBe('string');

      const labels = await labelsOf(asOwner);
      expect(labels.map((l) => l.name)).toEqual(['urgent']);
    });

    it('stores a provided color', async () => {
      const { asOwner } = await setupTeam();
      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels.post({ name: 'bug', color: '#123456' });
      expect(created.data).toMatchObject({ name: 'bug', color: '#123456' });
    });

    it('assigns the label to a group', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;

      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels.post({ name: 'urgent', groupId: group.id });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ groupId: group.id });
    });

    it('lists labels ordered by name', async () => {
      const { asOwner } = await setupTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' }).labels;
      await scope.post({ name: 'gamma' });
      await scope.post({ name: 'alpha' });
      await scope.post({ name: 'beta' });

      const labels = await labelsOf(asOwner);
      expect(labels.map((l) => l.name)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate name within the team', async () => {
      const { asOwner } = await setupTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' }).labels;
      await scope.post({ name: 'urgent' });
      const res = await scope.post({ name: 'urgent' });
      expect(res.status).toBe(409);
    });

    it('allows the same name in a different team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' });
      const res = await asOwner.teams({ teamKey: 'OPS' }).labels.post({ name: 'urgent' });
      expect(res.status).toBe(201);
    });
  });

  describe('update label', () => {
    it('updates the name and reflects it in the view', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: label.id })
        .patch({ name: 'critical' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ name: 'critical' });

      const labels = await labelsOf(asOwner);
      expect(labels.find((l) => l.id === label.id)?.name).toBe('critical');
    });

    it('updates the color', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: label.id })
        .patch({ color: '#abcdef' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ color: '#abcdef' });
    });

    it('assigns and clears the group', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;
      const scope = asOwner.teams({ teamKey: 'MKT' }).labels({ labelId: label.id });

      const grouped = await scope.patch({ groupId: group.id });
      expect(grouped.data).toMatchObject({ groupId: group.id });

      const ungrouped = await scope.patch({ groupId: null });
      expect(ungrouped.data).toMatchObject({ groupId: null });
    });

    it('returns the current label for an empty patch', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: label.id })
        .patch({});
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ id: label.id, name: 'urgent' });
    });

    it('returns 404 for a missing label', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: '00000000-0000-4000-8000-000000000000' })
        .patch({ name: 'nope' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: label.id })
        .patch({ name: '' });
      expect(res.status).toBe(400);
    });

    it("rejects renaming onto another label's name", async () => {
      const { asOwner } = await setupTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' }).labels;
      await scope.post({ name: 'urgent' });
      const bug = (await scope.post({ name: 'bug' })).data!;

      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: bug.id })
        .patch({ name: 'urgent' });
      expect(res.status).toBe(409);
    });
  });

  describe('delete label', () => {
    it('removes the label from the view', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;

      const del = await asOwner.teams({ teamKey: 'MKT' }).labels({ labelId: label.id }).delete();
      expect(del.status).toBe(204);

      const labels = await labelsOf(asOwner);
      expect(labels.map((l) => l.id)).not.toContain(label.id);
    });

    // The store deletes by (id, teamId) with no existence check, so a missing
    // id is a no-op that still returns 204.
    it('returns 204 for a missing label', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: '00000000-0000-4000-8000-000000000000' })
        .delete();
      expect(res.status).toBe(204);
    });
  });

  describe('create label group', () => {
    it('creates a group with a default color and lists it in the view', async () => {
      const { asOwner } = await setupTeam();

      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups'].post({ name: 'severity' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ name: 'severity', color: '#6b7280' });
      expect(typeof created.data?.id).toBe('string');

      const groups = await groupsOf(asOwner);
      expect(groups.map((g) => g.name)).toEqual(['severity']);
    });

    it('stores a provided color', async () => {
      const { asOwner } = await setupTeam();
      const created = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups'].post({ name: 'severity', color: '#123456' });
      expect(created.data).toMatchObject({ color: '#123456' });
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate name within the team', async () => {
      const { asOwner } = await setupTeam();
      const scope = asOwner.teams({ teamKey: 'MKT' })['label-groups'];
      await scope.post({ name: 'severity' });
      const res = await scope.post({ name: 'severity' });
      expect(res.status).toBe(409);
    });
  });

  describe('update label group', () => {
    it('updates the name and reflects it in the view', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;

      const patched = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: group.id })
        .patch({ name: 'priority' });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ name: 'priority' });

      const groups = await groupsOf(asOwner);
      expect(groups.find((g) => g.id === group.id)?.name).toBe('priority');
    });

    it('returns 404 for a missing group', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: '00000000-0000-4000-8000-000000000000' })
        .patch({ name: 'nope' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: group.id })
        .patch({ name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('delete label group', () => {
    it('removes the group from the view', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;

      const del = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: group.id })
        .delete();
      expect(del.status).toBe(204);

      const groups = await groupsOf(asOwner);
      expect(groups.map((g) => g.id)).not.toContain(group.id);
    });

    // Deleting a group ungroups its labels: label.group_id -> SET NULL, so the
    // labels survive with a null group.
    it('ungroups its labels instead of deleting them', async () => {
      const { asOwner } = await setupTeam();
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;
      const label = (
        await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent', groupId: group.id })
      ).data!;

      await asOwner.teams({ teamKey: 'MKT' })['label-groups']({ groupId: group.id }).delete();

      const labels = await labelsOf(asOwner);
      const survivor = labels.find((l) => l.id === label.id);
      expect(survivor).toBeDefined();
      expect(survivor?.groupId).toBeNull();
    });

    it('returns 204 for a missing group', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: '00000000-0000-4000-8000-000000000000' })
        .delete();
      expect(res.status).toBe(204);
    });
  });

  // A label is addressed as /teams/:teamKey/labels/:labelId and a group as
  // /teams/:teamKey/label-groups/:groupId. The permission guard runs on
  // :teamKey, so the store must scope the entity to that team — otherwise a
  // request under one team could edit or delete another team's label or
  // group by passing its id. delete has no existence check (always 204), so the
  // isolation is asserted by the foreign entity surviving, not by the status.
  describe('cross-team isolation', () => {
    async function twoTeams() {
      const { asOwner: api } = await setupTeam();
      await api.teams.post({ key: 'OPS', name: 'Operations' });
      const label = (await api.teams({ teamKey: 'OPS' }).labels.post({ name: 'urgent' })).data!;
      const group = (await api.teams({ teamKey: 'OPS' })['label-groups'].post({ name: 'severity' }))
        .data!;
      return { api, label, group };
    }

    it('does not patch a label from another team', async () => {
      const { api, label } = await twoTeams();
      const res = await api
        .teams({ teamKey: 'MKT' })
        .labels({ labelId: label.id })
        .patch({ name: 'hijacked' });
      expect(res.status).toBe(404);

      const ops = await labelsOf(api, 'OPS');
      expect(ops.find((l) => l.id === label.id)?.name).toBe('urgent');
    });

    it('does not delete a label from another team', async () => {
      const { api, label } = await twoTeams();
      await api.teams({ teamKey: 'MKT' }).labels({ labelId: label.id }).delete();

      const ops = await labelsOf(api, 'OPS');
      expect(ops.some((l) => l.id === label.id)).toBe(true);
    });

    it('does not patch a label group from another team', async () => {
      const { api, group } = await twoTeams();
      const res = await api
        .teams({ teamKey: 'MKT' })
        ['label-groups']({ groupId: group.id })
        .patch({ name: 'hijacked' });
      expect(res.status).toBe(404);

      const ops = await groupsOf(api, 'OPS');
      expect(ops.find((g) => g.id === group.id)?.name).toBe('severity');
    });

    it('does not delete a label group from another team', async () => {
      const { api, group } = await twoTeams();
      await api.teams({ teamKey: 'MKT' })['label-groups']({ groupId: group.id }).delete();

      const ops = await groupsOf(api, 'OPS');
      expect(ops.some((g) => g.id === group.id)).toBe(true);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupTeam();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).labels.post({ name: 'urgent' });
      expect(res.status).toBe(404);
    });

    it('denies a non-member on every label route', async () => {
      const { asOwner } = await setupTeam();
      const label = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'urgent' })).data!;
      const group = (
        await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'severity' })
      ).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);
      const scope = outsider.teams({ teamKey: 'MKT' });

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect((await scope.labels.post({ name: 'x' })).status).toBe(403);
      expect((await scope.labels({ labelId: label.id }).patch({ name: 'x' })).status).toBe(403);
      expect((await scope.labels({ labelId: label.id }).delete()).status).toBe(403);
      expect((await scope['label-groups'].post({ name: 'x' })).status).toBe(403);
      expect((await scope['label-groups']({ groupId: group.id }).patch({ name: 'x' })).status).toBe(
        403,
      );
      expect((await scope['label-groups']({ groupId: group.id }).delete()).status).toBe(403);
    });
  });
});
