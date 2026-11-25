import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createProject,
  createTeam,
  createWebhook,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createComment } from '../../../comments/store';
import { createDocument } from '../../store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Comments on documents: stored with document_id, visible through the document's
// parent, sent as Comment webhooks to its teams, and reachable over GraphQL with
// Linear's documentContentId.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const project = await createProject(owner, { teamIds: ['MKT'], name: 'Site' });
  const doc = await createDocument({ title: 'Spec', projectId: project.id }, owner.userId);
  return { owner, doc };
}

describe('document comments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sends the Comment webhook to the document's teams", async () => {
    const { owner, doc } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/h',
      resourceTypes: ['Comment'],
      teamId: 'MKT',
    });
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
    const outsider = await signUpAs('guest');
    const res = await gql({ cookie: outsider.cookie }, `{ comment(id: "${comment.id}") { id } }`);
    expect(res.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
  });
});
