import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createIssue, createTeam, gqlData } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { putObject } from '../../../shared/s3';
import { createAttachment, deleteAttachment } from '../../store';

// Uploaded files: bytes in the object store (shared/s3.ts against a real RustFS —
// see the Tests setup for S3_* env), uploaded through Linear's fileUpload and the
// signed upload URL, attached with attachmentCreate, and served on the public raw
// routes (/uploads/:id/raw and /attachments/:publicId/raw), whose headers are the
// XSS defense for attacker-controlled bytes.

const MISSING = '00000000-0000-0000-0000-000000000000';

async function setupIssue() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const issue = await createIssue(owner, {
    teamId: view.team.id,
    stateId: view.states[0]!.id,
    title: 'Task',
  });
  return { owner, issueId: issue.id };
}

const get = (path: string) => app.handle(new Request(`http://localhost${path}`));

// fileUpload, then PUT the bytes to the signed URL; returns the asset's raw path.
async function upload(who: TestUser, filename: string, contentType: string, content: string) {
  const body = new TextEncoder().encode(content);
  const data = await gqlData(
    who,
    `mutation ($ct: String!, $fn: String!, $size: Int!) {
      fileUpload(contentType: $ct, filename: $fn, size: $size) { uploadFile { uploadUrl assetUrl } } }`,
    { ct: contentType, fn: filename, size: body.length },
  );
  const { uploadUrl, assetUrl } = data.fileUpload.uploadFile;
  const put = await app.handle(
    new Request(`http://localhost${new URL(uploadUrl).pathname}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, cookie: who.cookie },
      body,
    }),
  );
  expect(put.status).toBe(200);
  return { assetUrl: assetUrl as string, path: new URL(assetUrl).pathname };
}

describe('attachments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('uploads bytes, attaches them, serves them on the raw route, and deletes the attachment', async () => {
    const { owner, issueId } = await setupIssue();
    const { assetUrl, path } = await upload(owner, 'note.txt', 'text/plain', 'hello world');
    const created = await gqlData(
      owner,
      `mutation ($input: AttachmentCreateInput!) { attachmentCreate(input: $input) {
        attachment { id title sourceType } } }`,
      { input: { issueId, url: assetUrl, title: 'note.txt' } },
    );
    expect(created.attachmentCreate.attachment).toMatchObject({
      title: 'note.txt',
      sourceType: 'upload',
    });
    const raw = await get(path);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe('hello world');
    await gqlData(owner, `mutation ($id: String!) { attachmentDelete(id: $id) { success } }`, {
      id: created.attachmentCreate.attachment.id,
    });
    const left = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { attachments { nodes { id } } } }`,
      { id: issueId },
    );
    expect(left.issue.attachments.nodes).toEqual([]);
  });

  it('serves a stored attachment on its public raw route until it is deleted', async () => {
    const { owner, issueId } = await setupIssue();
    const key = `test/${crypto.randomUUID()}`;
    await putObject(key, Buffer.from('stored'), 'text/plain');
    const row = await createAttachment({
      issueId,
      s3Key: key,
      filename: 'stored.txt',
      contentType: 'text/plain',
      sizeBytes: 6,
      creatorUserId: owner.userId,
    });
    const raw = await get(`/attachments/${row.publicId}/raw`);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe('stored');
    await deleteAttachment(row.id, owner.userId);
    expect((await get(`/attachments/${row.publicId}/raw`)).status).toBe(404);
  });

  it('rejects an empty file', async () => {
    const { owner } = await setupIssue();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { fileUpload(contentType: "text/plain", filename: "empty.txt", size: 0) { success } }`,
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('answers not found when deleting a missing attachment', async () => {
    const { owner } = await setupIssue();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation ($id: String!) { attachmentDelete(id: $id) { success } }`,
      { id: MISSING },
    );
    expect(res.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
  });

  describe('raw route headers', () => {
    it('forces download and sets nosniff and a CSP for a type outside the inline allowlist', async () => {
      const { owner } = await setupIssue();
      // SVG passes the upload allowlist (image/*) but is not on the raw route's
      // inline-media allowlist, so it is a stored-XSS vector the headers must defuse.
      const { path } = await upload(
        owner,
        'x.svg',
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      const raw = await get(path);
      expect(raw.status).toBe(200);
      expect(raw.headers.get('content-disposition')).toContain('attachment');
      expect(raw.headers.get('x-content-type-options')).toBe('nosniff');
      expect(raw.headers.get('content-security-policy')).toContain('sandbox');
    });

    it('serves an allowlisted image inline without a CSP', async () => {
      const { owner } = await setupIssue();
      const { path } = await upload(owner, 'p.png', 'image/png', 'pngbytes');
      const raw = await get(path);
      expect(raw.status).toBe(200);
      expect(raw.headers.get('content-disposition')).toContain('inline');
      expect(raw.headers.get('content-security-policy')).toBeNull();
    });

    it('forces download for an image when ?download is set', async () => {
      const { owner } = await setupIssue();
      const { path } = await upload(owner, 'p.png', 'image/png', 'pngbytes');
      const raw = await get(`${path}?download=1`);
      expect(raw.headers.get('content-disposition')).toContain('attachment');
    });

    it('answers 404 for an unknown attachment or upload', async () => {
      expect((await get(`/attachments/${MISSING}/raw`)).status).toBe(404);
      expect((await get(`/uploads/${MISSING}/raw`)).status).toBe(404);
    });
  });
});
