import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createLabel, retireLabel } from '../../store';

// Labels in Linear's shape: workspace labels (no team) apply to every team's
// issues; a group is a label that cannot be applied; a retired label stays on the
// issues that have it but cannot be newly applied. Workspace labels are created
// through the store here (the GraphQL mutations come in a later task).

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
  const issueIn = async (key: 'MKT' | 'OPS', stateId: string) =>
    (await asOwner.teams({ teamKey: key }).issues.post({ stateId, title: 'x' })).data!;
  return { owner, asOwner, mkt, ops, issueIn };
}

describe('labels model', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('refuses to apply a group to an issue', async () => {
    const { asOwner, mkt, issueIn } = await setup();
    const group = (await asOwner.teams({ teamKey: 'MKT' })['label-groups'].post({ name: 'Area' }))
      .data!;
    const issue = await issueIn('MKT', mkt.states[0].id);
    const res = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [group.id] });
    expect(res.status).toBe(400);
  });

  it('applies a workspace label to issues of two teams', async () => {
    const { owner, asOwner, mkt, ops, issueIn } = await setup();
    const ws = await createLabel({ teamId: null, name: 'Security', actorUserId: owner.userId });
    const a = await issueIn('MKT', mkt.states[0].id);
    const b = await issueIn('OPS', ops.states[0].id);
    for (const issue of [a, b]) {
      const res = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [ws.id] });
      expect(res.status).toBe(200);
      expect(res.data!.labelIds).toEqual([ws.id]);
    }
  });

  it("refuses another team's label", async () => {
    const { asOwner, mkt, issueIn } = await setup();
    const opsLabel = (await asOwner.teams({ teamKey: 'OPS' }).labels.post({ name: 'ops' })).data!;
    const issue = await issueIn('MKT', mkt.states[0].id);
    const res = await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [opsLabel.id] });
    expect(res.status).toBe(400);
  });

  it('keeps a retired label on its issue and refuses to apply it anew', async () => {
    const { owner, asOwner, mkt, issueIn } = await setup();
    const l = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'old' })).data!;
    const keep = await issueIn('MKT', mkt.states[0].id);
    const other = await issueIn('MKT', mkt.states[0].id);
    await asOwner.issues({ issueId: keep.id }).patch({ labelIds: [l.id] });
    await retireLabel(l.id, owner.userId);
    const again = await asOwner
      .issues({ issueId: keep.id })
      .patch({ labelIds: [l.id], title: 'still labelled' });
    expect(again.status).toBe(200);
    expect(again.data!.labelIds).toEqual([l.id]);
    expect((await asOwner.issues({ issueId: other.id }).patch({ labelIds: [l.id] })).status).toBe(
      400,
    );
  });

  it('lists workspace and retired labels in the team detail with their flags', async () => {
    const { owner, asOwner } = await setup();
    const ws = await createLabel({ teamId: null, name: 'Security', actorUserId: owner.userId });
    const l = (await asOwner.teams({ teamKey: 'MKT' }).labels.post({ name: 'old' })).data!;
    await retireLabel(l.id, owner.userId);
    const labels = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.labels;
    expect(labels.find((x) => x.id === ws.id)).toMatchObject({ teamId: null, retiredAt: null });
    expect(labels.find((x) => x.id === l.id)!.retiredAt).toBeTruthy();
  });
});
