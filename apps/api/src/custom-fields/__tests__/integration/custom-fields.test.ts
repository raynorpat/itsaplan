import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Custom fields belong to a team. A field with issueTypeId null is
// team-wide; a field with issueTypeId set applies only to issues of that
// type. Routes live under /teams/:teamKey/custom-fields, so the permission
// guard runs on :teamKey and the store scopes every field to that team.
// Fields are read back through GET /teams/:teamKey/custom-fields, which
// takes an optional issueTypeId query to include that type's own fields.

async function setupTeam() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  return { asOwner };
}

// Treaty maps the hyphenated segment as a bracketed accessor.
function fields(client: Api, teamKey = 'MKT') {
  return client.teams({ teamKey })['custom-fields'];
}

// The team's custom fields, optionally scoped to an issue type.
async function listFields(client: Api, issueTypeId?: string, teamKey = 'MKT') {
  const res = await fields(client, teamKey).get(
    issueTypeId != null ? { query: { issueTypeId } } : {},
  );
  return res.data!;
}

function createType(client: Api, name: string, teamKey = 'MKT') {
  return client.teams({ teamKey })['issue-types'].post({ name });
}

describe('custom-fields', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates a team-wide field with defaults and lists it', async () => {
      const { asOwner } = await setupTeam();

      const created = await fields(asOwner).post({ name: 'Severity', fieldType: 'text' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        name: 'Severity',
        fieldType: 'text',
        issueTypeId: null,
        showInBody: false,
        options: [],
      });
      expect(typeof created.data?.id).toBe('string');

      const list = await listFields(asOwner);
      expect(list.map((f) => f.name)).toContain('Severity');
    });

    it('stores showInBody when provided', async () => {
      const { asOwner } = await setupTeam();
      const created = await fields(asOwner).post({
        name: 'Owner',
        fieldType: 'text',
        showInBody: true,
      });
      expect(created.data).toMatchObject({ showInBody: true });
    });

    it('creates a select field with ordered options', async () => {
      const { asOwner } = await setupTeam();
      const created = await fields(asOwner).post({
        name: 'Priority',
        fieldType: 'select',
        options: ['Low', 'Medium', 'High'],
      });
      expect(created.status).toBe(201);
      expect(created.data?.options.map((o) => o.value)).toEqual(['Low', 'Medium', 'High']);
      expect(created.data?.options.map((o) => o.position)).toEqual([0, 1, 2]);
    });

    it('assigns increasing positions within the same scope', async () => {
      const { asOwner } = await setupTeam();
      const first = (await fields(asOwner).post({ name: 'A', fieldType: 'text' })).data!;
      const second = (await fields(asOwner).post({ name: 'B', fieldType: 'text' })).data!;
      expect(second.position).toBeGreaterThan(first.position);
    });

    it('creates a type-scoped field targeting a type of this team', async () => {
      const { asOwner } = await setupTeam();
      const type = (await createType(asOwner, 'Bug')).data!;

      const created = await fields(asOwner).post({
        name: 'Steps',
        fieldType: 'markdown',
        issueTypeId: type.id,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ issueTypeId: type.id });
    });

    it('rejects a type-scoped field whose type belongs to another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreignType = (await createType(asOwner, 'Bug', 'OPS')).data!;

      const res = await fields(asOwner).post({
        name: 'Steps',
        fieldType: 'text',
        issueTypeId: foreignType.id,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an issueTypeId that does not exist', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner).post({
        name: 'Steps',
        fieldType: 'text',
        issueTypeId: '00000000-0000-4000-8000-000000000000',
      });
      expect(res.status).toBe(400);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner).post({ name: '', fieldType: 'text' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown field type', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner).post({
        name: 'Weird',
        fieldType: 'nonsense' as unknown as 'text',
      });
      expect(res.status).toBe(400);
    });

    it('rejects an empty option value', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner).post({
        name: 'Priority',
        fieldType: 'select',
        options: [''],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('list', () => {
    it('returns only team-wide fields without an issueTypeId', async () => {
      const { asOwner } = await setupTeam();
      const type = (await createType(asOwner, 'Bug')).data!;
      await fields(asOwner).post({ name: 'Global', fieldType: 'text' });
      await fields(asOwner).post({ name: 'Scoped', fieldType: 'text', issueTypeId: type.id });

      const list = await listFields(asOwner);
      const names = list.map((f) => f.name);
      expect(names).toContain('Global');
      expect(names).not.toContain('Scoped');
    });

    it("includes a type's own fields when issueTypeId is passed", async () => {
      const { asOwner } = await setupTeam();
      const bug = (await createType(asOwner, 'Bug')).data!;
      const story = (await createType(asOwner, 'Story')).data!;
      await fields(asOwner).post({ name: 'Global', fieldType: 'text' });
      await fields(asOwner).post({ name: 'BugField', fieldType: 'text', issueTypeId: bug.id });
      await fields(asOwner).post({ name: 'StoryField', fieldType: 'text', issueTypeId: story.id });

      const list = await listFields(asOwner, bug.id);
      const names = list.map((f) => f.name);
      expect(names).toContain('Global');
      expect(names).toContain('BugField');
      // Another type's field must not leak in.
      expect(names).not.toContain('StoryField');
    });

    it('returns fields ordered by position', async () => {
      const { asOwner } = await setupTeam();
      await fields(asOwner).post({ name: 'First', fieldType: 'text' });
      await fields(asOwner).post({ name: 'Second', fieldType: 'text' });

      const list = await listFields(asOwner);
      const positions = list.map((f) => f.position);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
      expect(list.map((f) => f.name)).toEqual(['First', 'Second']);
    });

    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner, 'NOPE').get({});
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    it('updates the name and showInBody', async () => {
      const { asOwner } = await setupTeam();
      const field = (await fields(asOwner).post({ name: 'Severity', fieldType: 'text' })).data!;

      const patched = await fields(asOwner)({ fieldId: field.id }).patch({
        name: 'Level',
        showInBody: true,
      });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({ name: 'Level', showInBody: true });

      const list = await listFields(asOwner);
      expect(list.find((f) => f.id === field.id)).toMatchObject({
        name: 'Level',
        showInBody: true,
      });
    });

    it('returns 404 for a missing field', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner)({ fieldId: '00000000-0000-4000-8000-000000000000' }).patch({
        name: 'Nope',
      });
      expect(res.status).toBe(404);
    });

    it('rejects an empty name', async () => {
      const { asOwner } = await setupTeam();
      const field = (await fields(asOwner).post({ name: 'Severity', fieldType: 'text' })).data!;
      const res = await fields(asOwner)({ fieldId: field.id }).patch({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric field id', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner)({ fieldId: 'abc' as unknown as number }).patch({
        name: 'X',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes a field and drops it from the list', async () => {
      const { asOwner } = await setupTeam();
      const field = (
        await fields(asOwner).post({
          name: 'Priority',
          fieldType: 'select',
          options: ['Low', 'High'],
        })
      ).data!;

      const del = await fields(asOwner)({ fieldId: field.id }).delete();
      expect(del.status).toBe(204);

      const list = await listFields(asOwner);
      expect(list.map((f) => f.id)).not.toContain(field.id);
    });

    it('returns 404 for a missing field', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner)({
        fieldId: '00000000-0000-4000-8000-000000000000',
      }).delete();
      expect(res.status).toBe(404);
    });
  });

  // A field is addressed as /teams/:teamKey/custom-fields/:fieldId. The
  // permission guard runs on :teamKey, so the store scopes the field to that
  // team — a member of one team must not edit or delete another team's
  // field by passing its id.
  describe('cross-team isolation', () => {
    it('does not patch a field from another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = (await fields(asOwner, 'OPS').post({ name: 'Foreign', fieldType: 'text' }))
        .data!;

      const res = await fields(asOwner)({ fieldId: foreign.id }).patch({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const opsFields = await listFields(asOwner, undefined, 'OPS');
      expect(opsFields.find((f) => f.id === foreign.id)?.name).toBe('Foreign');
    });

    it('does not delete a field from another team', async () => {
      const { asOwner } = await setupTeam();
      await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
      const foreign = (await fields(asOwner, 'OPS').post({ name: 'Foreign', fieldType: 'text' }))
        .data!;

      const res = await fields(asOwner)({ fieldId: foreign.id }).delete();
      expect(res.status).toBe(404);

      const opsFields = await listFields(asOwner, undefined, 'OPS');
      expect(opsFields.map((f) => f.id)).toContain(foreign.id);
    });
  });

  describe('access', () => {
    it('returns 404 for an unknown team on create', async () => {
      const { asOwner } = await setupTeam();
      const res = await fields(asOwner, 'NOPE').post({ name: 'X', fieldType: 'text' });
      expect(res.status).toBe(404);
    });

    it('denies a non-member on every custom-fields route', async () => {
      const { asOwner } = await setupTeam();
      const field = (await fields(asOwner).post({ name: 'Severity', fieldType: 'text' })).data!;
      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so assert
      // the top-level HTTP status rather than error.status.
      expect((await fields(outsider).get({})).status).toBe(403);
      expect((await fields(outsider).post({ name: 'X', fieldType: 'text' })).status).toBe(403);
      expect((await fields(outsider)({ fieldId: field.id }).patch({ name: 'X' })).status).toBe(403);
      expect((await fields(outsider)({ fieldId: field.id }).delete()).status).toBe(403);
    });
  });
});
