import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import type { AuthUser } from '../../../shared/access';
import { assertDocumentParentAccess } from '../../access';
import {
  archiveDocument,
  createDocument,
  getDocument,
  unarchiveDocument,
  updateDocument,
} from '../../store';

// Documents: defaults, one parent, access through the parent, moves, archived
// parents, the trash, and Document webhooks.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const team = async (key: string) => (await asOwner.teams({ teamKey: key }).get()).data!;
  const mkt = await team('MKT');
  const ops = await team('OPS');
  const project = (await asOwner.projects.post({ teamIds: [mkt.team.id], name: 'Site' })).data!;
  const stateId = ops.states.find((s) => s.stateType === 'unstarted')!.id;
  const issue = (await asOwner.teams({ teamKey: 'OPS' }).issues.post({ stateId, title: 'Bug' }))
    .data!;
  return { owner, asOwner, project, issue };
}

async function addMember(owner: Api, teamKey: string, permissions: Record<string, unknown>) {
  const role = await owner.teams({ teamKey }).roles.post({ name: 'Limited', permissions });
  const user = await signUpTestUser();
  const invite = await owner
    .teams({ teamKey })
    .invites.post({ email: user.email, role: 'member', roleId: role.data!.id });
  await authedApi(user.cookie).invites({ token: invite.data!.token }).accept.post();
  return user;
}

const asUser = (id: string) => ({ id }) as AuthUser;

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

async function payloads(api: Api, webhookId: string) {
  return (await api.webhooks({ webhookId }).deliveries.get())
    .data!.items.map(
      (d) => d.payload as { action: string; type: string; data: Record<string, unknown> },
    )
    .reverse();
}

describe('documents', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a project document with defaults', async () => {
    const { owner, project } = await setup();
    const created = await createDocument(
      { title: 'Spec', content: '# Hello', projectId: project.id },
      owner.userId,
    );
    expect(created).toMatchObject({
      title: 'Spec',
      content: '# Hello',
      projectId: project.id,
      issueId: null,
      creatorUserId: owner.userId,
      updatedByUserId: owner.userId,
      trashed: null,
    });
    expect(created.slugId).toMatch(/^[0-9a-f]{12}$/);
    expect((await getDocument(created.slugId))?.id).toBe(created.id);
  });

  it('requires exactly one parent and a non-empty title', async () => {
    const { owner, project, issue } = await setup();
    expect(await status(createDocument({ title: 'X' }, owner.userId))).toBe(400);
    expect(
      await status(
        createDocument({ title: 'X', projectId: project.id, issueId: issue.id }, owner.userId),
      ),
    ).toBe(400);
    expect(await status(createDocument({ title: ' ', projectId: project.id }, owner.userId))).toBe(
      400,
    );
  });

  it('follows the access of the parent', async () => {
    const { asOwner, project, issue } = await setup();
    const blind = await addMember(asOwner, 'MKT', { projects: {} });
    expect(
      await status(
        assertDocumentParentAccess({ projectId: project.id }, asUser(blind.userId), 'read'),
      ),
    ).toBe(404);
    const reader = await addMember(asOwner, 'OPS', { work_items: { read: true } });
    expect(
      await status(
        assertDocumentParentAccess({ issueId: issue.id }, asUser(reader.userId), 'read'),
      ),
    ).toBe(200);
    expect(
      await status(
        assertDocumentParentAccess({ issueId: issue.id }, asUser(reader.userId), 'edit'),
      ),
    ).toBe(403);
  });

  it('moves a document from a project to an issue and tells both teams', async () => {
    const { owner, asOwner, project, issue } = await setup();
    const doc = await createDocument({ title: 'Spec', projectId: project.id }, owner.userId);
    const hooks = [];
    for (const key of ['MKT', 'OPS'])
      hooks.push(
        (
          await asOwner
            .teams({ teamKey: key })
            .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Document'] })
        ).data!,
      );
    const moved = (await updateDocument(doc.id, { issueId: issue.id }, owner.userId))!;
    expect(moved).toMatchObject({ projectId: null, issueId: issue.id });
    for (const hook of hooks)
      expect((await payloads(asOwner, hook.id)).map((p) => p.action)).toEqual(['update']);
  });

  it('rejects an archived parent', async () => {
    const { owner, asOwner, project } = await setup();
    const doc = await createDocument({ title: 'Spec', projectId: project.id }, owner.userId);
    await archiveDocument(doc.id, owner.userId);
    await asOwner.projects({ projectId: project.id }).archive.post();
    expect(
      await status(createDocument({ title: 'New', projectId: project.id }, owner.userId)),
    ).toBe(400);
    expect(await status(unarchiveDocument(doc.id, owner.userId))).toBe(400);
  });

  it('deletes to the trash and restores', async () => {
    const { owner, asOwner, project } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Document'] })
    ).data!;
    const doc = await createDocument({ title: 'Spec', projectId: project.id }, owner.userId);
    const trashed = await archiveDocument(doc.id, owner.userId);
    expect(trashed.archivedAt).toBeTruthy();
    expect(trashed.trashed).toBe(true);
    const restored = await unarchiveDocument(doc.id, owner.userId);
    expect(restored).toMatchObject({ archivedAt: null, trashed: null });
    const events = await payloads(asOwner, hook.id);
    expect(events.map((p) => `${p.type}:${p.action}`)).toEqual([
      'Document:create',
      'Document:remove',
      'Document:update',
    ]);
    expect(events[0]!.data).toMatchObject({
      id: doc.id,
      projectId: project.id,
      creatorId: owner.userId,
      subscriberIds: [],
    });
  });
});
