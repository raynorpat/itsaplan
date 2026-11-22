import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { attachment, db } from '@repo/db';
import {
  attachmentUrl,
  createAttachment,
  deleteAttachment,
  getTeamAttachmentBytes,
  updateAttachment,
  upsertLinkAttachment,
} from '../../store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Link attachments and uploads in one table: defaults, the upsert by issue and URL,
// URL rules, the absolute URL of uploads, REST and quota counting files only, and
// Attachment webhooks. Uploads are created through the store (no object store).

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const issue = (
    await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId: view.states[0]!.id, title: 'T' })
  ).data!;
  return { owner, asOwner, issueId: issue.id, teamId: view.team.id };
}

const file = (issueId: string) =>
  createAttachment({
    issueId,
    s3Key: `teams/x/attachments/${issueId}/a.png`,
    filename: 'a.png',
    contentType: 'image/png',
    sizeBytes: 42,
  });

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

async function payloads(webhookId: string) {
  return (await webhookDeliveries(webhookId))
    .data!.items.map(
      (d) => d.payload as { action: string; type: string; data: Record<string, unknown> },
    )
    .reverse();
}

describe('link attachments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a link with defaults', async () => {
    const { owner, issueId } = await setup();
    const { row, created } = await upsertLinkAttachment(
      { issueId, url: 'https://example.com/pr/1', title: 'PR 1' },
      owner.userId,
    );
    expect(created).toBe(true);
    expect(row).toMatchObject({
      issueId,
      url: 'https://example.com/pr/1',
      title: 'PR 1',
      metadata: {},
      sourceType: null,
      creatorUserId: owner.userId,
      s3Key: null,
    });
  });

  it('upserts by issue and url', async () => {
    const { owner, issueId } = await setup();
    const url = 'https://example.com/pr/1';
    const first = await upsertLinkAttachment({ issueId, url, title: 'PR 1' }, owner.userId);
    const second = await upsertLinkAttachment({ issueId, url, title: 'PR 1 v2' }, owner.userId);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.title).toBe('PR 1 v2');
  });

  it('rejects non-web urls and empty titles', async () => {
    const { owner, issueId } = await setup();
    for (const url of ['javascript:alert(1)', '/relative', 'ftp://x/y'])
      expect(await status(upsertLinkAttachment({ issueId, url, title: 'X' }, owner.userId))).toBe(
        400,
      );
    expect(
      await status(
        upsertLinkAttachment({ issueId, url: 'https://e.com', title: ' ' }, owner.userId),
      ),
    ).toBe(400);
  });

  it('marks uploads and normalises their absolute url', async () => {
    const { owner, issueId } = await setup();
    const up = await file(issueId);
    expect(up).toMatchObject({
      sourceType: 'upload',
      url: `/attachments/${up.publicId}/raw`,
      title: 'a.png',
    });
    const absolute = attachmentUrl(up);
    expect(absolute).toBe(`${process.env.API_URL}/attachments/${up.publicId}/raw`);
    const { row, created } = await upsertLinkAttachment(
      { issueId, url: absolute, title: 'Renamed' },
      owner.userId,
    );
    expect(created).toBe(false);
    expect(row).toMatchObject({
      id: up.id,
      title: 'Renamed',
      sourceType: 'upload',
      s3Key: up.s3Key,
    });
  });

  it('keeps links out of the REST list and quota', async () => {
    const { owner, asOwner, issueId, teamId } = await setup();
    await upsertLinkAttachment({ issueId, url: 'https://e.com/1', title: 'L' }, owner.userId);
    const up = await file(issueId);
    const list = (await asOwner.issues({ issueId }).attachments.get()).data!;
    expect(list.map((a) => a.id)).toEqual([up.publicId!]);
    expect(await getTeamAttachmentBytes(teamId)).toBe(42);
  });

  it('sends Attachment webhooks', async () => {
    const { owner, asOwner, issueId } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Attachment'] })
    ).data!;
    const { row } = await upsertLinkAttachment(
      { issueId, url: 'https://e.com/1', title: 'L' },
      owner.userId,
    );
    await updateAttachment(row.id, { title: 'L2' }, owner.userId);
    await deleteAttachment(row.id, owner.userId);
    const events = await payloads(hook.id);
    expect(events.map((p) => `${p.type}:${p.action}`)).toEqual([
      'Attachment:create',
      'Attachment:update',
      'Attachment:remove',
    ]);
    expect(events[0]!.data).toMatchObject({ id: row.id, issueId, source: null });
  });

  it('matches an upload url regardless of scheme and host case or query', async () => {
    const { owner, issueId } = await setup();
    const up = await file(issueId);
    const shouted = `${process.env.API_URL!.toUpperCase()}/attachments/${up.publicId}/raw?download=1`;
    const { row, created } = await upsertLinkAttachment(
      { issueId, url: shouted, title: 'Again' },
      owner.userId,
    );
    expect(created).toBe(false);
    expect(row.id).toBe(up.id);
  });

  it('names a missing upload when an api download url matches nothing', async () => {
    const { owner, issueId } = await setup();
    const url = `${process.env.API_URL}/attachments/${crypto.randomUUID()}/raw`;
    const err = await upsertLinkAttachment({ issueId, url, title: 'X' }, owner.userId).catch(
      (e: { status?: number; message?: string }) => e,
    );
    expect(err).toMatchObject({ status: 400 });
    expect((err as Error).message).toContain('upload');
  });

  it('rejects a non-web icon url', async () => {
    const { owner, issueId } = await setup();
    expect(
      await status(
        upsertLinkAttachment(
          { issueId, url: 'https://e.com/i', title: 'I', iconUrl: 'javascript:alert(1)' },
          owner.userId,
        ),
      ),
    ).toBe(400);
  });

  it('refuses an empty title in the database', async () => {
    const { issueId } = await setup();
    const insert = db.insert(attachment).values({ issueId, url: 'https://e.com/t', title: ' ' });
    expect(
      await insert.then(
        () => 'ok',
        () => 'refused',
      ),
    ).toBe('refused');
  });
});
