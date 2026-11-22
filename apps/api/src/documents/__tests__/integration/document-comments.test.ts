import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { assertParentAccess, createComment } from '../../../comments/store';
import type { AuthUser } from '../../../shared/access';
import { createDocument } from '../../store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Comments on documents: stored with document_id, visible through the document's
// parent, sent as Comment webhooks to its teams, and reachable over GraphQL with
// Linear's documentContentId.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const project = (await asOwner.projects.post({ teamIds: [mkt], name: 'Site' })).data!;
  const doc = await createDocument({ title: 'Spec', projectId: project.id }, owner.userId);
  return { owner, asOwner, doc };
}

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

describe('document comments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('stores a comment on a document, visible through its parent', async () => {
    const { owner, doc } = await setup();
    const parent = { documentId: doc.id };
    const c = await createComment({ parent, body: 'Looks good', actorUserId: owner.userId });
    expect(c.documentId).toBe(doc.id);
    const outsider = await signUpWithRole('guest');
    expect(await status(assertParentAccess(parent, { id: outsider.userId } as AuthUser))).toBe(404);
  });

  it("sends the Comment webhook to the document's teams", async () => {
    const { owner, asOwner, doc } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Comment'] })
    ).data!;
    await createComment({ parent: { documentId: doc.id }, body: 'Hi', actorUserId: owner.userId });
    const items = (await webhookDeliveries(hook.id)).data!.items;
    expect(items).toHaveLength(1);
  });

  it('comments over GraphQL with documentContentId', async () => {
    const { owner, doc } = await setup();
    const client = linearClient(await createApiKey(owner.cookie));
    const comment = (await (
      await client.createComment({ documentContentId: doc.id, body: 'Nice' })
    ).comment)!;
    expect(comment.documentContentId).toBe(doc.id);
    expect((await comment.documentContent)?.id).toBe(doc.id);
    const outsider = await signUpWithRole('guest');
    const res = await gql({ cookie: outsider.cookie }, `{ comment(id: "${comment.id}") { id } }`);
    expect(res.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
  });
});
