import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, fileUpload } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { putObject } from '../../../shared/s3';
import { deleteUnusedUploads, setUploadUsed } from '../../store';

// Linear's fileUpload: a signed, single-use upload URL bound to the uploader, the
// content type and the size; the purpose's own limits are checked when the asset is
// used (attachmentCreate for issue files, userUpdate for avatars). The object store
// is not always running in tests: checks that happen before storage run always;
// the cases that need stored bytes run only when the store answers.

let storeAvailable = false;

beforeAll(async () => {
  storeAvailable = await Promise.race([
    putObject('healthcheck/uploads-test', Buffer.from('ok'), 'text/plain').then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
});

type Session = { cookie: string; userId: string; email: string };

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const stateId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.states[0]!.id;
  const issue = (await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' }))
    .data!;
  return { owner, issueId: issue.id };
}

interface UploadFile {
  uploadUrl: string;
  assetUrl: string;
  contentType: string;
  size: number;
  headers: { key: string; value: string }[];
}

async function requestUpload(
  who: Session,
  contentType: string,
  size: number,
  filename = 'file.bin',
): Promise<{ file?: UploadFile; code?: string }> {
  const res = await gql(
    { cookie: who.cookie },
    `mutation($ct: String!, $fn: String!, $size: Int!) {
       fileUpload(contentType: $ct, filename: $fn, size: $size) {
         success uploadFile { uploadUrl assetUrl contentType size headers { key value } }
       }
     }`,
    { ct: contentType, fn: filename, size },
  );
  const data = res.body.data as { fileUpload?: { uploadFile: UploadFile } } | null;
  return {
    file: data?.fileUpload?.uploadFile,
    code: res.body.errors?.[0]?.extensions?.code as string | undefined,
  };
}

// PUT the bytes to the upload URL through the in-memory app (the URL is on the API).
function put(file: UploadFile, who: Session, body: Uint8Array, contentType = file.contentType) {
  const path = new URL(file.uploadUrl).pathname;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, cookie: who.cookie },
      body: body as unknown as BodyInit,
    }),
  );
}

// Marks an upload as stored without the object store, for the checks that run at use.
async function markStored(file: UploadFile) {
  const id = new URL(file.assetUrl).pathname.split('/')[2]!;
  await db.update(fileUpload).set({ completedAt: new Date() }).where(eq(fileUpload.id, id));
}

const bytes = (n: number) => new Uint8Array(n).fill(65);

describe('file uploads', () => {
  const envBefore = { ...process.env };
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    process.env.TEAM_QUOTA_MB = envBefore.TEAM_QUOTA_MB;
    process.env.MAX_AVATAR_MB = envBefore.MAX_AVATAR_MB;
  });

  it('uploads through a signed URL', async () => {
    if (!storeAvailable) return;
    const { owner, issueId } = await setup();
    const { file } = await requestUpload(owner, 'text/plain', 5, 'notes.txt');
    expect(file?.uploadUrl).toContain('/uploads/');
    expect((await put(file!, owner, bytes(5))).status).toBe(200);
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", url: "${file!.assetUrl}", title: "Notes" }) {
         attachment { title sourceType } } }`,
    );
    expect(res.body.errors).toBeUndefined();
    expect(
      (res.body.data as { attachmentCreate: { attachment: { sourceType: string } } })
        .attachmentCreate.attachment.sourceType,
    ).toBe('upload');
  });

  it('refuses an expired or mismatched upload before storing it', async () => {
    const { owner } = await setup();
    const other = await signUpTestUser();
    const { file } = await requestUpload(owner, 'text/plain', 5);
    expect(file).toBeDefined();
    // The token is the credential (as in Linear): another user's session reaches the
    // same checks, so a wrong content type is still a 400.
    expect((await put(file!, other, bytes(5), 'text/html')).status).toBe(400);
    // A different content type than declared.
    expect((await put(file!, owner, bytes(5), 'text/html')).status).toBe(400);
    // A larger body than declared.
    expect((await put(file!, owner, bytes(6))).status).toBe(413);
    // An expired upload URL.
    const id = new URL(file!.assetUrl).pathname.split('/')[2]!;
    await db
      .update(fileUpload)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(fileUpload.id, id));
    expect((await put(file!, owner, bytes(5))).status).toBe(410);
  });

  it('refuses a second use of the same upload URL', async () => {
    if (!storeAvailable) return;
    const { owner } = await setup();
    const { file } = await requestUpload(owner, 'text/plain', 5);
    expect((await put(file!, owner, bytes(5))).status).toBe(200);
    expect((await put(file!, owner, bytes(5))).status).toBe(410);
  });

  it('refuses a request the server limits cannot accept', async () => {
    const { owner } = await setup();
    process.env.MAX_ATTACHMENT_MB = '1';
    process.env.MAX_AVATAR_MB = '1';
    expect((await requestUpload(owner, 'text/plain', 2 * 1024 * 1024)).code).toBe('INVALID_INPUT');
    expect((await requestUpload(owner, 'text/plain', 0)).code).toBe('INVALID_INPUT');
    delete process.env.MAX_ATTACHMENT_MB;
  });

  it('words a refusal like the REST upload', async () => {
    const { owner } = await setup();
    process.env.MAX_ATTACHMENT_MB = '1';
    process.env.MAX_AVATAR_MB = '1';
    const message = async (ct: string, size: number) =>
      (
        await gql(
          { cookie: owner.cookie },
          `mutation($ct: String!, $size: Int!) {
             fileUpload(contentType: $ct, filename: "f", size: $size) { success }
           }`,
          { ct, size },
        )
      ).body.errors?.[0]?.message;
    expect(await message('text/plain', 2 * 1024 * 1024)).toBe('File exceeds the 1 MB limit');
    expect(await message('application/x-msdownload', 10)).toBe(
      'Files of type application/x-msdownload are not allowed',
    );
    delete process.env.MAX_ATTACHMENT_MB;
    delete process.env.MAX_AVATAR_MB;
  });

  it('checks the purpose at use', async () => {
    const { owner, issueId } = await setup();
    const other = await signUpTestUser();

    // The team quota is checked when the file becomes an attachment.
    process.env.TEAM_QUOTA_MB = '0.000001';
    const big = (await requestUpload(owner, 'text/plain', 100, 'big.txt')).file!;
    await markStored(big);
    const quota = await gql(
      { cookie: owner.cookie },
      `mutation { attachmentCreate(input: { issueId: "${issueId}", url: "${big.assetUrl}", title: "Big" }) { success } }`,
    );
    expect(quota.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    delete process.env.TEAM_QUOTA_MB;

    const setAvatar = (who: Session, url: string | null) =>
      gql(
        { cookie: who.cookie },
        `mutation($id: String!, $url: String) { userUpdate(id: $id, input: { avatarUrl: $url }) { user { avatarUrl } } }`,
        { id: who.userId, url },
      );

    // An SVG is never an avatar.
    const svg = (await requestUpload(owner, 'image/svg+xml', 10, 'a.svg')).file!;
    await markStored(svg);
    expect((await setAvatar(owner, svg.assetUrl)).body.errors?.[0]?.extensions?.code).toBe(
      'INVALID_INPUT',
    );

    // An image over the avatar limit.
    process.env.MAX_AVATAR_MB = '0.000001';
    const large = (await requestUpload(owner, 'image/png', 100, 'a.png')).file!;
    await markStored(large);
    expect((await setAvatar(owner, large.assetUrl)).body.errors?.[0]?.extensions?.code).toBe(
      'INVALID_INPUT',
    );
    delete process.env.MAX_AVATAR_MB;

    // Another user's upload.
    const theirs = (await requestUpload(other, 'image/png', 10, 'b.png')).file!;
    await markStored(theirs);
    expect((await setAvatar(owner, theirs.assetUrl)).body.errors?.[0]?.extensions?.code).toBe(
      'INVALID_INPUT',
    );

    // The uploader's own stored image becomes the avatar; null clears it.
    const mine = (await requestUpload(owner, 'image/png', 10, 'c.png')).file!;
    await markStored(mine);
    const set = await setAvatar(owner, mine.assetUrl);
    expect(set.body.errors).toBeUndefined();
    expect(
      (set.body.data as { userUpdate: { user: { avatarUrl: string } } }).userUpdate.user.avatarUrl,
    ).toContain('/uploads/');
    const cleared = await setAvatar(owner, null);
    expect(
      (cleared.body.data as { userUpdate: { user: { avatarUrl: string | null } } }).userUpdate.user
        .avatarUrl,
    ).toBeNull();
  });

  it('sets the time zone and refuses updating someone else', async () => {
    const { owner } = await setup();
    const other = await signUpTestUser();
    const update = (who: Session, id: string, tz: string) =>
      gql(
        { cookie: who.cookie },
        `mutation($id: String!, $tz: String) { userUpdate(id: $id, input: { timezone: $tz }) { user { timezone } } }`,
        { id, tz },
      );
    const ok = await update(owner, owner.userId, 'Europe/Berlin');
    expect(ok.body.errors).toBeUndefined();
    expect(
      (ok.body.data as { userUpdate: { user: { timezone: string } } }).userUpdate.user.timezone,
    ).toBe('Europe/Berlin');
    expect(
      (await update(owner, owner.userId, 'Mars/Olympus')).body.errors?.[0]?.extensions?.code,
    ).toBe('INVALID_INPUT');
    expect((await update(owner, other.userId, 'UTC')).body.errors?.[0]?.extensions?.code).toBe(
      'FORBIDDEN',
    );
  });

  it('deletes uploads nothing used within a day', async () => {
    const { owner } = await setup();
    await requestUpload(owner, 'text/plain', 5);
    const used = (await requestUpload(owner, 'text/plain', 5)).file!;
    const idOf = (f: UploadFile) => new URL(f.assetUrl).pathname.split('/')[2]!;
    await setUploadUsed(idOf(used), true);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.update(fileUpload).set({ createdAt: old });
    expect(await deleteUnusedUploads()).toBe(1);
    const left = await db.select({ id: fileUpload.id }).from(fileUpload);
    expect(left.map((r) => r.id)).toEqual([idOf(used)]);
  });
});
