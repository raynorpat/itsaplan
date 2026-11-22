import { beforeEach, describe, expect, it } from 'bun:test';
import { db, fileUpload } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { addToTeam, makePrivate } from '../../../__tests__/helpers/roles';

// The final review of the GraphQL gaps: single-use uploads, the upload URL as the
// credential, the unused-upload cap, userUpdate writing nothing on an invalid input,
// private custom views, and history hiding related issues the viewer cannot see.

interface UploadFile {
  uploadUrl: string;
  assetUrl: string;
  contentType: string;
}

const codeOf = (res: { body: { errors?: { extensions?: { code?: unknown } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const stateId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.states[0]!.id;
  const newIssue = async (title: string, teamKey = 'MKT', state = stateId) =>
    (await asOwner.teams({ teamKey }).issues.post({ stateId: state, title })).data!;
  return { owner, asOwner, stateId, newIssue };
}

async function requestUpload(who: TestUser, contentType: string, size: number) {
  const res = await gql(
    { cookie: who.cookie },
    `mutation($ct: String!, $size: Int!) {
       fileUpload(contentType: $ct, filename: "f.bin", size: $size) {
         uploadFile { uploadUrl assetUrl contentType } } }`,
    { ct: contentType, size },
  );
  const data = res.body.data as { fileUpload?: { uploadFile: UploadFile } } | null;
  return { file: data?.fileUpload?.uploadFile, code: codeOf(res) };
}

const idOf = (file: UploadFile) => new URL(file.assetUrl).pathname.split('/')[2]!;

// Marks an upload as stored without the object store.
async function markStored(file: UploadFile) {
  await db
    .update(fileUpload)
    .set({ completedAt: new Date() })
    .where(eq(fileUpload.id, idOf(file)));
}

const attach = (who: TestUser, issueId: string, url: string) =>
  gql(
    { cookie: who.cookie },
    `mutation($issueId: String!, $url: String!) {
       attachmentCreate(input: { issueId: $issueId, url: $url, title: "F" }) { success } }`,
    { issueId, url },
  );

const setAvatar = (who: TestUser, url: string | null, timezone?: string) =>
  gql(
    { cookie: who.cookie },
    `mutation($id: String!, $url: String, $tz: String) {
       userUpdate(id: $id, input: { avatarUrl: $url, timezone: $tz }) { success } }`,
    { id: who.userId, url, tz: timezone },
  );

describe('graphql gaps review fixes', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets one upload back only one attachment or avatar', async () => {
    const { owner, newIssue } = await setup();
    const a = await newIssue('A');
    const b = await newIssue('B');
    const { file } = await requestUpload(owner, 'image/png', 10);
    await markStored(file!);
    expect((await attach(owner, a.id, file!.assetUrl)).body.errors).toBeUndefined();
    expect(codeOf(await attach(owner, b.id, file!.assetUrl))).toBe('INVALID_INPUT');
    expect(codeOf(await setAvatar(owner, file!.assetUrl))).toBe('INVALID_INPUT');

    // An upload used as an avatar cannot become an attachment either.
    const second = (await requestUpload(owner, 'image/png', 10)).file!;
    await markStored(second);
    expect((await setAvatar(owner, second.assetUrl)).body.errors).toBeUndefined();
    expect(codeOf(await attach(owner, a.id, second.assetUrl))).toBe('INVALID_INPUT');
  });

  it('accepts the upload URL as the only credential', async () => {
    const { owner, newIssue } = await setup();
    const other = await signUpTestUser();
    const issue = await newIssue('A');
    const { file } = await requestUpload(owner, 'text/plain', 5);
    const path = new URL(file!.uploadUrl).pathname;
    // No session: the token is checked, not the caller (a wrong type is a 400, not 401).
    const anonymous = await app.handle(
      new Request(`http://localhost${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: new Uint8Array(5) as unknown as BodyInit,
      }),
    );
    expect(anonymous.status).toBe(400);
    // Another user cannot use someone else's stored upload.
    await markStored(file!);
    expect(codeOf(await attach(other, issue.id, file!.assetUrl))).not.toBeUndefined();
    expect(codeOf(await setAvatar(other, file!.assetUrl))).toBe('INVALID_INPUT');
  });

  it("caps a user's unused uploads", async () => {
    const { owner } = await setup();
    process.env.MAX_ATTACHMENT_MB = String(10 / (1024 * 1024));
    try {
      for (let i = 0; i < 10; i++)
        expect((await requestUpload(owner, 'text/plain', 10)).code).toBeUndefined();
      expect((await requestUpload(owner, 'text/plain', 10)).code).toBe('INVALID_INPUT');
    } finally {
      delete process.env.MAX_ATTACHMENT_MB;
    }
  });

  it('writes nothing when part of a userUpdate is invalid', async () => {
    const { owner } = await setup();
    const res = await setAvatar(owner, 'https://example.com/not-an-upload.png', 'Europe/Berlin');
    expect(codeOf(res)).toBe('INVALID_INPUT');
    const read = await gql({ cookie: owner.cookie }, '{ viewer { timezone } }');
    expect((read.body.data as { viewer: { timezone: string | null } }).viewer.timezone).not.toBe(
      'Europe/Berlin',
    );
  });

  it('keeps a non-shared view to its owner', async () => {
    const { owner, asOwner } = await setup();
    const member = await signUpTestUser();
    await addToTeam(asOwner, 'MKT', member);
    const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { customViewCreate(input: { name: "Mine", teamId: "${teamId}", shared: false }) {
         customView { id } } }`,
    );
    const viewId = (created.body.data as { customViewCreate: { customView: { id: string } } })
      .customViewCreate.customView.id;
    const list = await gql({ cookie: member.cookie }, '{ customViews { nodes { id } } }');
    expect((list.body.data as { customViews: { nodes: unknown[] } }).customViews.nodes).toEqual([]);
    expect(
      codeOf(await gql({ cookie: member.cookie }, `{ customView(id: "${viewId}") { id } }`)),
    ).toBe('ENTITY_NOT_FOUND');
    expect(
      codeOf(
        await gql(
          { cookie: member.cookie },
          `mutation { customViewUpdate(id: "${viewId}", input: { name: "X" }) { success } }`,
        ),
      ),
    ).toBe('ENTITY_NOT_FOUND');
    expect(
      codeOf(
        await gql(
          { cookie: member.cookie },
          `mutation { customViewDelete(id: "${viewId}") { success } }`,
        ),
      ),
    ).toBe('ENTITY_NOT_FOUND');
    // The owner of a new view is its creator.
    expect(
      codeOf(
        await gql(
          { cookie: owner.cookie },
          `mutation { customViewCreate(input: { name: "Theirs", teamId: "${teamId}", ownerId: "${member.userId}" }) { success } }`,
        ),
      ),
    ).toBe('INVALID_INPUT');
  });

  it('hides related issues the viewer cannot see in history', async () => {
    const { owner, asOwner, newIssue } = await setup();
    await asOwner.teams.post({ key: 'SEC', name: 'Security' });
    await makePrivate(asOwner, 'SEC');
    const secState = (await asOwner.teams({ teamKey: 'SEC' }).get()).data!.states[0]!.id;
    const open = await newIssue('Open');
    const secret = await newIssue('Secret', 'SEC', secState);
    const member = await signUpTestUser();
    await addToTeam(asOwner, 'MKT', member);
    const rel = await gql(
      { cookie: owner.cookie },
      `mutation { issueRelationCreate(input: { issueId: "${open.id}", relatedIssueId: "${secret.id}", type: blocks }) { success } }`,
    );
    expect(rel.body.errors).toBeUndefined();
    const historyOf = async (who: TestUser) => {
      const res = await gql(
        { cookie: who.cookie },
        `{ issue(id: "${open.id}") { history { nodes { relationChanges { identifier type } } } } }`,
      );
      return JSON.stringify(res.body.data);
    };
    expect(await historyOf(owner)).toContain('SEC-');
    expect(await historyOf(member)).not.toContain('SEC-');
  });
});
