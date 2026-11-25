import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { putObject } from '../../../shared/s3';
import { deleteImportFile, readImportFile } from '../../import-files';

// Import files: a CSV uploaded through Linear's fileUpload with
// `metaData: { purpose: "import" }`. Owners and admins request them, the workspace's
// attachment type list does not apply, the public raw route never serves them, and
// only the uploader reads them back.

let storeAvailable = false;

beforeAll(async () => {
  storeAvailable = await Promise.race([
    putObject('healthcheck/import-files-test', Buffer.from('ok'), 'text/plain').then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
});

type Session = { cookie: string; userId: string };

interface UploadFile {
  uploadUrl: string;
  assetUrl: string;
  contentType: string;
}

async function requestImportUpload(
  who: Session,
  contentType: string,
  size: number,
  metaData: unknown = { purpose: 'import' },
): Promise<{ file?: UploadFile; code?: string; message?: string }> {
  const res = await gql(
    { cookie: who.cookie },
    `mutation($ct: String!, $size: Int!, $meta: JSON) {
       fileUpload(contentType: $ct, filename: "export.csv", size: $size, metaData: $meta) {
         success uploadFile { uploadUrl assetUrl contentType }
       }
     }`,
    { ct: contentType, size, meta: metaData },
  );
  const data = res.body.data as { fileUpload?: { uploadFile: UploadFile } } | null;
  return {
    file: data?.fileUpload?.uploadFile,
    code: res.body.errors?.[0]?.extensions?.code as string | undefined,
    message: res.body.errors?.[0]?.message,
  };
}

function put(file: UploadFile, body: string) {
  const path = new URL(file.uploadUrl).pathname;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.contentType },
      body,
    }),
  );
}

const rawPath = (file: UploadFile) => new URL(file.assetUrl).pathname;

describe('import files', () => {
  beforeEach(resetDb);

  it('accepts the CSV types even when the workspace limits attachment types', async () => {
    const owner = await signUpAs('owner');
    const set = await gql(
      { cookie: owner.cookie },
      `mutation { organizationUpdate(input: { allowedFileUploadContentTypes: ["image/*"] }) { success } }`,
    );
    expect(set.body.errors).toBeUndefined();
    for (const type of [
      'text/csv',
      'application/vnd.ms-excel',
      'text/plain',
      'application/octet-stream',
    ]) {
      const { file, message } = await requestImportUpload(owner, type, 10);
      expect(message).toBeUndefined();
      expect(file?.contentType).toBe(type);
    }
    // The same type as an ordinary attachment is still refused.
    expect((await requestImportUpload(owner, 'text/csv', 10, null)).code).toBe('INVALID_INPUT');
  });

  it('accepts metaData given as a JSON string', async () => {
    const owner = await signUpAs('owner');
    const { file } = await requestImportUpload(owner, 'text/csv', 10, '{"purpose":"import"}');
    expect(file).toBeDefined();
  });

  it('refuses other types and members', async () => {
    const owner = await signUpAs('owner');
    const member = await signUpAs('member');
    const wrong = await requestImportUpload(owner, 'image/png', 10);
    expect(wrong.code).toBe('INVALID_INPUT');
    expect(wrong.message).toBe('An import file must be a CSV file');
    expect((await requestImportUpload(member, 'text/csv', 10)).code).toBe('FORBIDDEN');
  });

  it('is never served by the public raw route', async () => {
    if (!storeAvailable) return;
    const owner = await signUpAs('owner');
    const { file } = await requestImportUpload(owner, 'text/csv', 12);
    expect((await put(file!, 'Title\nOne\nT')).status).toBe(200);
    const res = await app.handle(new Request(`http://localhost${rawPath(file!)}`));
    expect(res.status).toBe(404);
  });

  it('is read back only by its uploader, with its hash, and deleted after', async () => {
    if (!storeAvailable) return;
    const owner = await signUpAs('owner');
    const admin = await signUpAs('admin');
    const body = 'Title\nOne\n';
    const { file } = await requestImportUpload(owner, 'text/csv', body.length);
    expect((await put(file!, body)).status).toBe(200);
    const read = await readImportFile(owner.userId, file!.assetUrl);
    expect(read.text).toBe(body);
    expect(read.sha256).toBe(new Bun.CryptoHasher('sha256').update(body).digest('hex'));
    await expect(readImportFile(admin.userId, file!.assetUrl)).rejects.toThrow(
      'Import file not found',
    );
    await deleteImportFile(file!.assetUrl);
    await expect(readImportFile(owner.userId, file!.assetUrl)).rejects.toThrow(
      'Import file not found',
    );
  });

  it('does not read an ordinary upload as an import file', async () => {
    if (!storeAvailable) return;
    const owner = await signUpAs('owner');
    const { file } = await requestImportUpload(owner, 'text/plain', 3, null);
    expect((await put(file!, 'abc')).status).toBe(200);
    await expect(readImportFile(owner.userId, file!.assetUrl)).rejects.toThrow(
      'Import file not found',
    );
  });
});
