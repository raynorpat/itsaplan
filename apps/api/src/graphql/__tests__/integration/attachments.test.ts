import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createAttachment } from '../../../attachments/store';

// Attachments over the Linear API: links and uploads, the upsert by URL, comments
// from commentBody, visibility, deletes and input rules. Uploads are created through
// the store (no object store in tests).

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const stateId = view.states[0]!.id;
  const issue = (await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Bug' }))
    .data!;
  const other = (await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Other' }))
    .data!;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, client, issueId: issue.id, otherId: other.id };
}

const upload = (issueId: string) =>
  createAttachment({
    issueId,
    s3Key: `teams/x/attachments/${issueId}/shot.png`,
    filename: 'shot.png',
    contentType: 'image/png',
    sizeBytes: 10,
  });

describe('graphql attachments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, reads, updates and lists links', async () => {
    const { client, issueId } = await setup();
    const url = 'https://github.com/acme/app/pull/7';
    const created = (await (
      await client.createAttachment({
        issueId,
        title: 'PR 7',
        url,
        subtitle: 'Open',
        metadata: { n: 1 },
      })
    ).attachment)!;
    expect(created).toMatchObject({ title: 'PR 7', url, subtitle: 'Open', metadata: { n: 1 } });
    expect((await client.attachment(created.id)).title).toBe('PR 7');
    expect((await client.attachment(url)).id).toBe(created.id);
    const renamed = (await (
      await client.updateAttachment(created.id, { title: 'PR #7' })
    ).attachment)!;
    expect(renamed.title).toBe('PR #7');
    expect((await (await client.issue(issueId)).attachments()).nodes.map((a) => a.id)).toEqual([
      created.id,
    ]);
    expect((await client.attachments()).nodes).toHaveLength(1);
    expect((await client.attachmentsForURL(url)).nodes.map((a) => a.id)).toEqual([created.id]);
    expect((await client.attachmentIssue(created.id)).id).toBe(issueId);
    expect((await (await client.attachment(created.id)).issue)?.id).toBe(issueId);
  });

  it('upserts on attachmentCreate and attachmentLinkURL', async () => {
    const { client, issueId } = await setup();
    const url = 'https://example.com/a';
    const first = (await (await client.createAttachment({ issueId, title: 'A', url })).attachment)!;
    const second = (await (
      await client.createAttachment({ issueId, title: 'A2', url })
    ).attachment)!;
    expect(second.id).toBe(first.id);
    const linked = (await (
      await client.attachmentLinkURL(issueId, 'https://example.com/b')
    ).attachment)!;
    expect(linked.title).toBe('https://example.com/b');
    const relinked = (await (await client.attachmentLinkURL(issueId, url)).attachment)!;
    expect(relinked).toMatchObject({ id: first.id, title: 'A2' });
    expect((await (await client.issue(issueId)).attachments()).nodes).toHaveLength(2);
  });

  it('upserts onto a file by its absolute url', async () => {
    const { client, issueId } = await setup();
    const file = await upload(issueId);
    const seen = await client.attachment(file.id);
    expect(seen).toMatchObject({ sourceType: 'upload', title: 'shot.png' });
    expect(seen.url).toBe(`${process.env.API_URL}/attachments/${file.publicId}/raw`);
    const renamed = (await (
      await client.createAttachment({ issueId, url: seen.url, title: 'Renamed' })
    ).attachment)!;
    expect(renamed).toMatchObject({ id: file.id, sourceType: 'upload', title: 'Renamed' });
    expect((await (await client.issue(issueId)).attachments()).nodes).toHaveLength(1);
  });

  it('adds a comment from commentBody', async () => {
    const { client, issueId } = await setup();
    await client.createAttachment({
      issueId,
      title: 'Ticket',
      url: 'https://example.com/t/1',
      commentBody: 'Linked the ticket',
    });
    const comments = await (await client.issue(issueId)).comments();
    expect(comments.nodes.map((c) => c.body)).toEqual(['Linked the ticket']);
  });

  it('hides attachments from users who cannot see the issue', async () => {
    const { client, issueId } = await setup();
    const url = 'https://example.com/secret';
    const link = (await (await client.createAttachment({ issueId, title: 'S', url })).attachment)!;
    const outsider = await signUpTestUser();
    const one = await gql({ cookie: outsider.cookie }, `{ attachment(id: "${link.id}") { id } }`);
    expect(errorCode(one)).toBe('ENTITY_NOT_FOUND');
    const lists = await gql(
      { cookie: outsider.cookie },
      `{ attachments { nodes { id } } attachmentsForURL(url: "${url}") { nodes { id } } }`,
    );
    expect(lists.body.data).toEqual({
      attachments: { nodes: [] },
      attachmentsForURL: { nodes: [] },
    });
  });

  it('deletes a link, and a file with its embed', async () => {
    const { client, issueId } = await setup();
    const link = (await (
      await client.createAttachment({ issueId, title: 'L', url: 'https://example.com/l' })
    ).attachment)!;
    expect((await client.deleteAttachment(link.id)).success).toBe(true);
    const file = await upload(issueId);
    const url = `${process.env.API_URL}/attachments/${file.publicId}/raw`;
    await client.updateIssue(issueId, { description: `Before\n\n![shot](${url})\n\nAfter` });
    await client.deleteAttachment(file.id);
    const description = (await client.issue(issueId)).description ?? '';
    expect(description).not.toContain(file.publicId!);
    expect(description).toContain('After');
    expect((await (await client.issue(issueId)).attachments()).nodes).toHaveLength(0);
  });

  it('rejects unsupported input and bad urls', async () => {
    const { owner, issueId } = await setup();
    const asUser = await gql(
      { cookie: owner.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", title: "X", url: "https://e.com", createAsUser: "Bot" }) { success } }`,
    );
    expect(errorCode(asUser)).toBe('INVALID_INPUT');
    expect(errorMessage(asUser)).toContain('createAsUser');
    const script = await gql(
      { cookie: owner.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", title: "X", url: "javascript:alert(1)" }) { success } }`,
    );
    expect(errorCode(script)).toBe('INVALID_INPUT');
  });

  it('needs work_items.create to attach', async () => {
    const { asOwner, issueId } = await setup();
    const role = await asOwner
      .teams({ teamKey: 'MKT' })
      .roles.post({ name: 'Readers', permissions: { work_items: { read: true } } });
    const user = await signUpTestUser();
    const invite = await asOwner
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: user.email, role: 'member', roleId: role.data!.id });
    await authedApi(user.cookie).invites({ token: invite.data!.token }).accept.post();
    const res = await gql(
      { cookie: user.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", title: "X", url: "https://e.com" }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });
});
