import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, externalUser } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { startSmtpSink, type SmtpSink } from '../../../__tests__/helpers/smtp';
import {
  createBoard,
  instance,
  ok,
  portal,
  visitor,
  type Json,
} from '../../../portal/__tests__/helpers';
import { requesterChanges, requestersWithChangesSince, type Change } from '../../changes';
import { dbNow } from '../../clock';
import { runChangeEmails, runSummaries } from '../../run';
import { later } from '../helpers';

// "Shipped in <release>": an issue a person follows ships once it is in a completed
// release of a production pipeline and is itself completed, at the latest of the three.

let sink: SmtpSink;
beforeAll(() => {
  sink = startSmtpSink();
});
afterAll(() => sink.stop());

async function setup(opts: { isProduction?: boolean; rollover?: boolean } = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Mia' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await addMember(owner, 'ENG', member.userId);
  const states = statesByType(eng);
  const board = await createBoard(owner, { slug: 'acme', name: 'Acme', teamId: eng.team.id });
  const issue = await createIssue(member, {
    teamId: 'ENG',
    title: 'Dark mode',
    stateId: states.started,
  });
  const v = await visitor('acme', 'Jo');
  await ok(
    await portal(`boards/acme/issues/${issue.identifier}/vote`, { cookie: v.cookie, body: {} }),
  );
  const data = await gqlData(
    owner,
    `mutation($input: ReleasePipelineCreateInput!) {
      releasePipelineCreate(input: $input) { releasePipeline { id } }
    }`,
    {
      input: {
        name: 'Production',
        type: 'scheduled',
        teamIds: [eng.team.id],
        isProduction: opts.isProduction ?? true,
        rolloverIssuesOnCompletion: opts.rollover ?? true,
      },
    },
  );
  const pipelineId = data.releasePipelineCreate.releasePipeline.id as string;
  const rel = await gqlData(
    owner,
    `mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { release { id } } }`,
    { input: { pipelineId, name: 'v1.0', version: '1.0' } },
  );
  const releaseId = rel.releaseCreate.release.id as string;
  await gqlData(
    owner,
    `mutation($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`,
    { input: { issueId: issue.id, releaseId } },
  );
  return { owner, member, states, board, issue, v, pipelineId, releaseId };
}

const complete = (as: TestUser, pipelineId: string) =>
  gqlData(
    as,
    `mutation($input: ReleaseCompleteInput!) { releaseComplete(input: $input) { success } }`,
    { input: { pipelineId, version: '1.0' } },
  );

const tick = () => Bun.sleep(5);

// Issue and release completion times are stamped on the API's clock and link times on
// the database's, so a window spans both clocks.
const earliest = async () => new Date(Math.min((await dbNow()).getTime(), Date.now()));
const latest = async () => new Date(Math.max((await dbNow()).getTime(), Date.now()));

async function window(fn: () => Promise<unknown>): Promise<{ since: Date; until: Date }> {
  const since = await earliest();
  await tick();
  await fn();
  await tick();
  return { since, until: await latest() };
}

const shipped = (changes: Change[]) => changes.filter((c) => c.kind === 'shipped');

const mailsTo = (email: string) => sink.mails.filter((m) => m.to.includes(email));

beforeEach(async () => {
  await resetDb();
  sink.mails = [];
  sink.fail = false;
  delete process.env.SMTP_HOST;
});

describe('shipped changes', () => {
  it('reports a completed issue in a completed production release once', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup();
    const w = await window(async () => {
      await updateIssue(member, issue.id, { stateId: states.completed });
      await complete(owner, pipelineId);
    });
    const changes = shipped(await requesterChanges(v.requesterId, w.since, w.until));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'shipped',
      issueId: issue.id,
      title: 'Dark mode',
      releaseName: 'v1.0',
      url: expect.stringContaining(`/portal/acme/${issue.identifier}`),
    });
    expect(await requestersWithChangesSince(w.since)).toContain(v.requesterId);
  });

  it('reports nothing for a release of a pipeline that is not production', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup({ isProduction: false });
    const w = await window(async () => {
      await updateIssue(member, issue.id, { stateId: states.completed });
      await complete(owner, pipelineId);
    });
    expect(shipped(await requesterChanges(v.requesterId, w.since, w.until))).toEqual([]);
  });

  it('ships an issue still in progress only once it is completed', async () => {
    // Without rollover, the unfinished issue stays on the completed release.
    const { owner, member, states, issue, v, pipelineId } = await setup({ rollover: false });
    const first = await window(() => complete(owner, pipelineId));
    expect(shipped(await requesterChanges(v.requesterId, first.since, first.until))).toEqual([]);
    const second = await window(() => updateIssue(member, issue.id, { stateId: states.completed }));
    const changes = shipped(await requesterChanges(v.requesterId, second.since, second.until));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ releaseName: 'v1.0' });
  });

  it('ships an issue added to a release that is already completed', async () => {
    const { owner, member, states, v, pipelineId, releaseId } = await setup();
    await complete(owner, pipelineId);
    const other = await createIssue(member, {
      teamId: 'ENG',
      title: 'Export',
      stateId: states.completed,
    });
    await ok(
      await portal(`boards/acme/issues/${other.identifier}/vote`, { cookie: v.cookie, body: {} }),
    );
    const w = await window(() =>
      gqlData(
        owner,
        `mutation($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`,
        { input: { issueId: other.id, releaseId } },
      ),
    );
    const changes = shipped(await requesterChanges(v.requesterId, w.since, w.until));
    expect(changes.map((c) => c.kind === 'shipped' && c.title)).toEqual(['Export']);
  });

  it('reports nothing to a person who can no longer read the issue', async () => {
    const { owner, member, states, board, issue, v, pipelineId } = await setup();
    await ok(await instance('portal/boards/update', owner, { id: board.id, enabled: false }));
    const w = await window(async () => {
      await updateIssue(member, issue.id, { stateId: states.completed });
      await complete(owner, pipelineId);
    });
    expect(shipped(await requesterChanges(v.requesterId, w.since, w.until))).toEqual([]);
  });

  it('does not ship an issue while its release is in progress, whatever completedAt says', async () => {
    const { owner, member, states, issue, v, releaseId } = await setup();
    const w = await window(async () => {
      await updateIssue(member, issue.id, { stateId: states.completed });
      await gqlData(
        owner,
        `mutation($id: String!, $input: ReleaseUpdateInput!) { releaseUpdate(id: $id, input: $input) { success } }`,
        { id: releaseId, input: { completedAt: new Date(Date.now() - 1000).toISOString() } },
      );
    });
    expect(shipped(await requesterChanges(v.requesterId, w.since, w.until))).toEqual([]);
  });

  it('shows the release on the portal issue page', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup();
    const before = (await ok(
      await portal(`boards/acme/issues/${issue.identifier}`, { cookie: v.cookie }),
    )) as Json;
    expect(before.shipped).toBeNull();
    await updateIssue(member, issue.id, { stateId: states.completed });
    await complete(owner, pipelineId);
    const after = (await ok(
      await portal(`boards/acme/issues/${issue.identifier}`, { cookie: v.cookie }),
    )) as Json;
    expect(after.shipped).toMatchObject({ releaseName: 'v1.0', at: expect.any(String) });
  });
});

describe('shipped emails', () => {
  it('mails "Shipped in" once, and not again after the issue is reopened and completed', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.completed });
    await complete(owner, pipelineId);
    await later(6);
    expect(await runChangeEmails(new Date())).toEqual({ sent: 1 });
    expect(mailsTo(v.email)[0]!.text).toContain('Dark mode shipped in v1.0');
    await updateIssue(member, issue.id, { stateId: states.started });
    await updateIssue(member, issue.id, { stateId: states.completed });
    await later(11);
    await runChangeEmails(new Date());
    const mails = mailsTo(v.email);
    expect(mails.slice(1).some((m) => m.text.includes('shipped in'))).toBe(false);
  });

  it('still lists a shipped issue in the summary after a change email sent it', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup();
    await ok(await portal('me/updates', { cookie: v.cookie, body: { summary: 'daily' } }));
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.completed });
    await complete(owner, pipelineId);
    await later(6);
    expect(await runChangeEmails(new Date())).toEqual({ sent: 1 });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(9, 0, 0, 0);
    expect(await runSummaries(tomorrow)).toEqual({ sent: 1 });
    expect(mailsTo(v.email)[1]!.text).toContain('Dark mode shipped in v1.0');
  });
});

describe('shipped since your last visit', () => {
  const sinceLastVisit = async (cookie: string) =>
    (await ok(await portal('me/since-last-visit', { cookie }))) as { lines: string[] };

  it('shows a shipment once, not again after the issue is reopened and completed', async () => {
    const { owner, member, states, issue, v, pipelineId } = await setup();
    await sinceLastVisit(v.cookie);
    // The person last came two hours ago; the next request is a new visit.
    await db
      .update(externalUser)
      .set({ lastVisitAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(externalUser.id, v.requesterId));
    await updateIssue(member, issue.id, { stateId: states.completed });
    await complete(owner, pipelineId);
    // The issue's completion is stamped on the API's clock, which may run ahead of the
    // database's (the visit's `until`); wait past the difference.
    await Bun.sleep(200);
    expect((await sinceLastVisit(v.cookie)).lines).toContain('Dark mode shipped in v1.0');
    await updateIssue(member, issue.id, { stateId: states.started });
    await updateIssue(member, issue.id, { stateId: states.completed });
    // Two hours pass for the visit (and what it showed) and the new completion; the
    // next request is a new visit.
    await db.execute(
      sql`UPDATE external_user SET last_visit_at = last_visit_at - interval '2 hours' WHERE id = ${v.requesterId}`,
    );
    await db.execute(
      sql`UPDATE issue SET completed_at = completed_at - interval '2 hours' WHERE id = ${issue.id}`,
    );
    await db.execute(
      sql`UPDATE requester_shipped SET sent_at = sent_at - interval '2 hours' WHERE requester_id = ${v.requesterId}`,
    );
    const again = (await sinceLastVisit(v.cookie)).lines;
    expect(again).not.toContain('Dark mode shipped in v1.0');
  });
});
