import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { visibleInitiativesSql } from '../../access';
import { createInitiative } from '../../store';
import {
  createRelation,
  getProjectLink,
  linkProject,
  unlinkProject,
  visibleSubtreeIds,
} from '../../links';

// Project links and sub-initiatives: one link per project, one parent per
// initiative, no loops, at most 5 levels, the visible subtree, webhooks.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const project = (await asOwner.projects.post({ teamIds: [mkt], name: 'Site' })).data!;
  const make = (name: string, leadTeamId?: string) =>
    createInitiative({ name, ...(leadTeamId ? { leadTeamId } : {}) }, owner.userId);
  return { owner, asOwner, mkt, project, make };
}

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

describe('initiative links and relations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('links a project once and unlinks it', async () => {
    const { owner, project, make } = await setup();
    const a = await make('A');
    const link = await linkProject({ initiativeId: a.id, projectId: project.id }, owner.userId);
    expect(link).toMatchObject({ initiativeId: a.id, projectId: project.id });
    expect(
      await status(linkProject({ initiativeId: a.id, projectId: project.id }, owner.userId)),
    ).toBe(400);
    await unlinkProject(link.id, owner.userId);
    expect(await getProjectLink(link.id)).toBeNull();
  });

  it('allows one parent and no loops', async () => {
    const { owner, make } = await setup();
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    await createRelation({ initiativeId: a.id, relatedInitiativeId: b.id }, owner.userId);
    const relate = (parent: string, child: string) =>
      status(createRelation({ initiativeId: parent, relatedInitiativeId: child }, owner.userId));
    expect(await relate(c.id, b.id)).toBe(400);
    expect(await relate(b.id, a.id)).toBe(400);
    expect(await relate(a.id, a.id)).toBe(400);
  });

  it('allows at most 5 levels', async () => {
    const { owner, make } = await setup();
    const chain = [];
    for (let i = 0; i < 6; i++) chain.push(await make(`L${i + 1}`));
    for (let i = 0; i < 4; i++)
      await createRelation(
        { initiativeId: chain[i]!.id, relatedInitiativeId: chain[i + 1]!.id },
        owner.userId,
      );
    expect(
      await status(
        createRelation(
          { initiativeId: chain[4]!.id, relatedInitiativeId: chain[5]!.id },
          owner.userId,
        ),
      ),
    ).toBe(400);
    // A two-level subtree under level 4 would make 6 levels.
    const [x, y] = [await make('X'), await make('Y')];
    await createRelation({ initiativeId: x.id, relatedInitiativeId: y.id }, owner.userId);
    expect(
      await status(
        createRelation({ initiativeId: chain[3]!.id, relatedInitiativeId: x.id }, owner.userId),
      ),
    ).toBe(400);
  });

  it('stops the visible subtree at initiatives the viewer cannot see', async () => {
    const { owner, asOwner, mkt, make } = await setup();
    const a = await make('A');
    const b = await make('B', mkt);
    const c = await make('C');
    await createRelation({ initiativeId: a.id, relatedInitiativeId: b.id }, owner.userId);
    await createRelation({ initiativeId: b.id, relatedInitiativeId: c.id }, owner.userId);
    const member = await signUpTestUser();
    const invite = await asOwner
      .teams({ teamKey: 'OPS' })
      .invites.post({ email: member.email, role: 'member' });
    await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();
    expect(await visibleSubtreeIds(a.id, await visibleInitiativesSql(member.userId))).toEqual([
      a.id,
    ]);
    expect(
      (await visibleSubtreeIds(a.id, await visibleInitiativesSql(owner.userId))).sort(),
    ).toEqual([a.id, b.id, c.id].sort());
  });

  it('sends Initiative updates for link and relation changes', async () => {
    const { owner, asOwner, project, make } = await setup();
    const hook = (
      await asOwner.webhooks.post({
        url: 'https://example.com/h',
        resourceTypes: ['Initiative'],
      })
    ).data!;
    const [a, b] = [await make('A'), await make('B')];
    await linkProject({ initiativeId: a.id, projectId: project.id }, owner.userId);
    await createRelation({ initiativeId: a.id, relatedInitiativeId: b.id }, owner.userId);
    const updates = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get())
      .data!.items.map(
        (d) =>
          d.payload as {
            action: string;
            data: {
              id: string;
              projects: { id: string }[];
              parentInitiative: { id: string } | null;
              subInitiatives: { id: string }[];
            };
          },
      )
      .filter((p) => p.action === 'update')
      .reverse();
    expect(updates[0]!.data.projects.map((p) => p.id)).toEqual([project.id]);
    expect(
      updates
        .slice(1)
        .map((u) => u.data.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(updates.find((u) => u.data.id === b.id)!.data.parentInitiative?.id).toBe(a.id);
    expect(updates.find((u) => u.data.id === a.id && u.data.subInitiatives.length)).toBeTruthy();
  });
});
