import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
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

  it('describes a file in its metadata', async () => {
    const { client, issueId } = await setup();
    const file = await upload(issueId);
    const seen = await client.attachment(file.id);
    expect(seen.metadata).toMatchObject({
      filename: 'shot.png',
      contentType: 'image/png',
      size: 10,
    });
    const link = (await (
      await client.createAttachment({ issueId, title: 'L', url: 'https://example.com/l' })
    ).attachment)!;
    expect(link.metadata).toEqual({});
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
    const outsider = await signUpWithRole('guest');
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

  it('needs to see the team to attach', async () => {
    const { issueId } = await setup();
    const guest = await signUpWithRole('guest');
    const res = await gql(
      { cookie: guest.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", title: "X", url: "https://e.com" }) { success } }`,
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });

  it('filters attachments', async () => {
    const { owner, client, issueId } = await setup();
    await client.createAttachment({ issueId, title: 'Spec doc', url: 'https://e.com/spec' });
    const file = await upload(issueId);
    const q = async (filter: string) =>
      JSON.stringify(
        (
          await gql(
            { cookie: owner.cookie },
            `{ attachments(filter: ${filter}) { nodes { title } } }`,
          )
        ).body.data,
      );
    expect(await q('{ title: { contains: "Spec" } }')).not.toContain('shot.png');
    expect(await q('{ title: { contains: "Spec" } }')).toContain('Spec doc');
    const fileUrl = `${process.env.API_URL}/attachments/${file.publicId}/raw`;
    expect(await q(`{ url: { eq: "${fileUrl}" } }`)).toContain('shot.png');
    expect(await q(`{ url: { eq: "${fileUrl}" } }`)).not.toContain('Spec doc');
    expect(await q('{ sourceType: { eq: "upload" } }')).not.toContain('Spec doc');
    expect(await q(`{ creator: { id: { eq: "${owner.userId}" } } }`)).toContain('Spec doc');
    expect(await q(`{ creator: { id: { eq: "${owner.userId}" } } }`)).not.toContain('shot.png');
  });

  it('filters issues by attachments', async () => {
    const { owner, client, issueId } = await setup();
    await client.createAttachment({ issueId, title: 'PR', url: 'https://github.com/a/b/pull/1' });
    const q = async (filter: string) =>
      JSON.stringify(
        (await gql({ cookie: owner.cookie }, `{ issues(filter: ${filter}) { nodes { title } } }`))
          .body.data,
      );
    const some = await q('{ attachments: { some: { url: { contains: "github" } } } }');
    expect(some).toContain('Bug');
    expect(some).not.toContain('Other');
    const none = await q('{ attachments: { length: { eq: 0 } } }');
    expect(none).toContain('Other');
    expect(none).not.toContain('Bug');
    const every = await q('{ attachments: { every: { title: { eq: "PR" } } } }');
    expect(every).toContain('Bug');
  });

  it('does not count a null field as matching in every', async () => {
    const { owner, client, issueId } = await setup();
    await client.createAttachment({ issueId, title: 'Link', url: 'https://e.com/x' });
    const res = await gql(
      { cookie: owner.cookie },
      '{ issues(filter: { attachments: { every: { sourceType: { eq: "upload" } } } }) { nodes { title } } }',
    );
    expect(JSON.stringify(res.body.data)).not.toContain('"Bug"');
  });

  it('accepts an issue identifier as issueId', async () => {
    const { client, issueId } = await setup();
    const identifier = (await client.issue(issueId)).identifier;
    const created = (await (
      await client.createAttachment({ issueId: identifier, title: 'PR', url: 'https://e.com/pr' })
    ).attachment)!;
    expect((await created.issue)?.id).toBe(issueId);
    const linked = (await (
      await client.attachmentLinkURL(identifier, 'https://e.com/l')
    ).attachment)!;
    expect((await linked.issue)?.id).toBe(issueId);
  });

  it('stores a long link url', async () => {
    const { client, issueId } = await setup();
    const noise = Array.from({ length: 400 }, () => crypto.randomUUID()).join('');
    const url = `https://grafana.example.com/d/x?state=${noise}`;
    const created = (await (
      await client.createAttachment({ issueId, title: 'Dash', url })
    ).attachment)!;
    expect(created.url).toBe(url);
    const again = (await (
      await client.createAttachment({ issueId, title: 'Dash 2', url })
    ).attachment)!;
    expect(again.id).toBe(created.id);
  });

  it('gives a hidden attachment the same error as a missing one', async () => {
    const { client, issueId } = await setup();
    const link = (await (
      await client.createAttachment({ issueId, title: 'S', url: 'https://e.com/s' })
    ).attachment)!;
    const outsider = await signUpWithRole('guest');
    const res = await gql({ cookie: outsider.cookie }, `{ attachment(id: "${link.id}") { id } }`);
    expect(errorMessage(res)).toBe(`Attachment ${link.id} not found`);
  });

  it('lists the attachments of an archived issue', async () => {
    const { client, issueId } = await setup();
    await client.createAttachment({ issueId, title: 'A', url: 'https://e.com/a' });
    await client.archiveIssue(issueId);
    expect((await (await client.issue(issueId)).attachments()).nodes).toHaveLength(1);
    expect((await client.attachments()).nodes).toHaveLength(0);
  });
});
