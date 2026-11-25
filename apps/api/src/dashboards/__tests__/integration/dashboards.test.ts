import { beforeEach, describe, expect, it } from 'bun:test';
import { db, user as userTable } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { addMember, createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { instance, ok, type Json } from '../../../portal/__tests__/helpers';

// Dashboards through /api/auth/instance/dashboards*: members, admins and owners create
// and read the dashboards shared with them; guests have none. The owner and workspace
// owners / admins edit; anyone who sees one duplicates it. One workspace feedback report.

const widget = (id: string) => ({
  id,
  kind: 'chart',
  width: 'half',
  config: { title: 'Requests', data: 'requests', measure: 'requests' },
});

const create = async (as: TestUser, body: Json) =>
  (await ok(await instance('dashboards/create', as, body))).dashboard as Json;

const list = async (as: TestUser) =>
  (await ok(await instance('dashboards', as))).dashboards as Json[];

const read = (as: TestUser, id: string) => instance(`dashboard?id=${id}`, as);

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const admin = await signUpAs('admin', { name: 'Ada' });
  const member = await signUpAs('member', { name: 'Mia' });
  const other = await signUpAs('member', { name: 'Otto' });
  const guest = await signUpAs('guest', { name: 'Gus' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
  await addMember(owner, 'ENG', member.userId);
  await addMember(owner, 'OPS', other.userId);
  await addMember(owner, 'ENG', guest.userId);
  return { owner, admin, member, other, guest, eng, ops };
}

describe('dashboards', () => {
  beforeEach(resetDb);

  it('a member creates, reads and lists a workspace dashboard', async () => {
    const { member, other } = await setup();
    const made = await create(member, {
      name: 'Mine',
      description: 'What we ship',
      sharedWith: 'workspace',
      teamIds: [],
      widgets: [widget('a')],
    });
    expect(made.name).toBe('Mine');
    expect(made.ownerId).toBe(member.userId);
    expect(made.canEdit).toBe(true);
    expect(made.widgets).toEqual([widget('a')]);
    const read1 = await ok(await read(member, made.id));
    expect(read1.dashboard.description).toBe('What we ship');
    expect((await list(other)).map((d) => d.name)).toEqual(['Mine']);
    expect((await list(other))[0]!.canEdit).toBe(false);
    expect((await list(other))[0]!.ownerName).toBe('Mia');
  });

  it('guests are refused on every endpoint', async () => {
    const { member, guest } = await setup();
    const made = await create(member, { name: 'X', sharedWith: 'workspace', widgets: [] });
    expect((await instance('dashboards', guest)).status).toBe(403);
    expect((await read(guest, made.id)).status).toBe(403);
    for (const [path, body] of [
      ['dashboards/create', { name: 'G', sharedWith: 'workspace', widgets: [] }],
      ['dashboards/update', { id: made.id, name: 'G' }],
      ['dashboards/delete', { id: made.id }],
      ['dashboards/duplicate', { id: made.id }],
      ['dashboards/feedback', { widgets: [] }],
    ] as const)
      expect((await instance(path, guest, body)).status).toBe(403);
  });

  it('a team dashboard is seen by that team and by admins, not by another team', async () => {
    const { member, other, admin, eng } = await setup();
    const made = await create(member, {
      name: 'ENG only',
      sharedWith: 'teams',
      teamIds: [eng.team.id],
      widgets: [],
    });
    expect((await read(other, made.id)).status).toBe(404);
    expect((await list(other)).length).toBe(0);
    const seen = await ok(await read(admin, made.id));
    expect(seen.dashboard.canEdit).toBe(true);
    await ok(await instance('dashboards/update', admin, { id: made.id, name: 'Renamed' }));
    expect((await ok(await read(member, made.id))).dashboard.name).toBe('Renamed');
  });

  it('team sharing needs a team the member is in', async () => {
    const { member, ops } = await setup();
    expect(
      (
        await instance('dashboards/create', member, {
          name: 'X',
          sharedWith: 'teams',
          teamIds: [],
          widgets: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await instance('dashboards/create', member, {
          name: 'X',
          sharedWith: 'teams',
          teamIds: [ops.team.id],
          widgets: [],
        })
      ).status,
    ).toBe(400);
  });

  it('only the owner and admins edit or delete', async () => {
    const { member, other, owner } = await setup();
    const made = await create(member, { name: 'X', sharedWith: 'workspace', widgets: [] });
    expect((await instance('dashboards/update', other, { id: made.id, name: 'Y' })).status).toBe(
      403,
    );
    expect((await instance('dashboards/delete', other, { id: made.id })).status).toBe(403);
    await ok(await instance('dashboards/update', member, { id: made.id, widgets: [widget('b')] }));
    expect((await ok(await read(member, made.id))).dashboard.widgets).toEqual([widget('b')]);
    await ok(await instance('dashboards/delete', owner, { id: made.id }));
    expect((await read(member, made.id)).status).toBe(404);
  });

  it('a dashboard whose owner left is edited by admins only', async () => {
    const { member, other, admin } = await setup();
    const made = await create(member, { name: 'X', sharedWith: 'workspace', widgets: [] });
    await db.delete(userTable).where(eq(userTable.id, member.userId));
    const seen = await ok(await read(other, made.id));
    expect(seen.dashboard.ownerId).toBeNull();
    expect(seen.dashboard.canEdit).toBe(false);
    expect((await instance('dashboards/update', other, { id: made.id, name: 'Y' })).status).toBe(
      403,
    );
    await ok(await instance('dashboards/update', admin, { id: made.id, name: 'Y' }));
  });

  it('duplicating gives the caller their own copy', async () => {
    const { member, other } = await setup();
    const made = await create(member, {
      name: 'Shared',
      sharedWith: 'workspace',
      widgets: [widget('a')],
    });
    const copy = (await ok(await instance('dashboards/duplicate', other, { id: made.id })))
      .dashboard as Json;
    expect(copy.id).not.toBe(made.id);
    expect(copy.name).toBe('Shared (copy)');
    expect(copy.ownerId).toBe(other.userId);
    expect(copy.canEdit).toBe(true);
    expect(copy.systemKey).toBeNull();
    expect(copy.widgets).toEqual([widget('a')]);
  });

  it('refuses too many widgets, too large widgets and bad widgets', async () => {
    const { member } = await setup();
    const many = Array.from({ length: 25 }, (_, i) => widget(`w${i}`));
    expect(
      (
        await instance('dashboards/create', member, {
          name: 'X',
          sharedWith: 'workspace',
          widgets: many,
        })
      ).status,
    ).toBe(400);
    const big = [{ ...widget('a'), config: { title: 'x'.repeat(110_000) } }];
    expect(
      (
        await instance('dashboards/create', member, {
          name: 'X',
          sharedWith: 'workspace',
          widgets: big,
        })
      ).status,
    ).toBe(400);
    const bad = [{ id: 'a', kind: 'pie', width: 'half', config: {} }];
    expect(
      (
        await instance('dashboards/create', member, {
          name: 'X',
          sharedWith: 'workspace',
          widgets: bad,
        })
      ).status,
    ).toBe(400);
    expect(
      (await instance('dashboards/create', member, { name: '', sharedWith: 'workspace' })).status,
    ).toBe(400);
  });

  it('the feedback report is one workspace dashboard with no owner', async () => {
    const { member, other, admin } = await setup();
    const [a, b] = await Promise.all([
      instance('dashboards/feedback', member, { widgets: [widget('a')] }),
      instance('dashboards/feedback', other, { widgets: [widget('b')] }),
    ]);
    const first = (await ok(a!)).dashboard as Json;
    const second = (await ok(b!)).dashboard as Json;
    expect(first.id).toBe(second.id);
    expect(first.systemKey).toBe('feedback');
    expect(first.ownerId).toBeNull();
    expect(first.name).toBe('Feedback');
    expect(first.sharedWith).toBe('workspace');
    expect(first.canEdit).toBe(false);
    expect((await list(other)).length).toBe(1);
    expect((await instance('dashboards/update', member, { id: first.id, name: 'Y' })).status).toBe(
      403,
    );
    await ok(await instance('dashboards/update', admin, { id: first.id, name: 'Feedback report' }));
    await ok(await instance('dashboards/delete', admin, { id: first.id }));
    const again = (await ok(await instance('dashboards/feedback', member, { widgets: [] })))
      .dashboard as Json;
    expect(again.id).not.toBe(first.id);
    expect(again.systemKey).toBe('feedback');
  });
});
