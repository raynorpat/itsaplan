import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  signUpAs,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { startSmtpSink, type SmtpSink } from '../../../__tests__/helpers/smtp';
import { createBoard, ok, portal, visitor } from '../../../portal/__tests__/helpers';
import { runChangeEmails, runSummaries } from '../../run';

// Change emails and summaries: the worker-triggered runs that mail each person with
// updates on what changed on what they follow, through the instance mail provider.

let sink: SmtpSink;
beforeAll(() => {
  sink = startSmtpSink();
});
afterAll(() => sink.stop());

const MINUTE = 60_000;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Mia' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await addMember(owner, 'ENG', member.userId);
  const states = statesByType(eng);
  await createBoard(owner, { slug: 'acme', name: 'Acme', teamId: eng.team.id });
  const issue = await createIssue(member, {
    teamId: 'ENG',
    title: 'Dark mode',
    stateId: states.unstarted,
  });
  // Visitors sign in with the provider off, so their sign-in links are logged.
  const v = await visitor('acme', 'Jo');
  await ok(
    await portal(`boards/acme/issues/${issue.identifier}/vote`, { cookie: v.cookie, body: {} }),
  );
  return { owner, member, states, issue, v };
}

const mailsTo = (email: string) => sink.mails.filter((m) => m.to.includes(email));

// The next Monday at 09:00 UTC after `d`.
function nextMonday(d: Date): Date {
  const m = new Date(d);
  m.setUTCHours(9, 0, 0, 0);
  do m.setUTCDate(m.getUTCDate() + 1);
  while (m.getUTCDay() !== 1);
  return m;
}

beforeEach(async () => {
  await resetDb();
  sink.mails = [];
  sink.fail = false;
  delete process.env.SMTP_HOST;
});

describe('change emails', () => {
  it('mails a person one email for a status change, with the unsubscribe headers', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    expect(await runChangeEmails(new Date())).toEqual({ sent: 1 });
    const mails = mailsTo(v.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.headers.subject).toBe('Updates on what you asked for');
    expect(mails[0]!.text).toContain('Dark mode moved to In progress');
    expect(mails[0]!.headers['list-unsubscribe']).toMatch(
      /^<https?:\/\/[^>]+\/portal\/unsubscribe\/one-click\?token=[^>]+>$/,
    );
    expect(mails[0]!.headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    expect(mails[0]!.headers.from).toContain('plan@example.com');
  });

  it('sends nothing more within 10 minutes, then only the new change', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    const first = new Date();
    await runChangeEmails(first);
    await updateIssue(member, issue.id, { stateId: states.completed });
    expect(await runChangeEmails(new Date(first.getTime() + MINUTE))).toEqual({ sent: 0 });
    expect(await runChangeEmails(new Date(first.getTime() + 11 * MINUTE))).toEqual({ sent: 1 });
    const mails = mailsTo(v.email);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.text).toContain('Dark mode moved to Done');
    expect(mails[1]!.text).not.toContain('moved to In progress');
  });

  it('sends one email when two runs overlap', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    const now = new Date();
    await Promise.all([runChangeEmails(now), runChangeEmails(now)]);
    expect(mailsTo(v.email)).toHaveLength(1);
  });

  it('sends the same changes again after a failed send', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    sink.fail = true;
    expect(await runChangeEmails(new Date())).toEqual({ sent: 0 });
    sink.fail = false;
    expect(await runChangeEmails(new Date())).toEqual({ sent: 1 });
    const mails = mailsTo(v.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('Dark mode moved to In progress');
  });

  it('sends and marks nothing without a mail provider', async () => {
    const { member, states, issue, v } = await setup();
    await updateIssue(member, issue.id, { stateId: states.started });
    expect(await runChangeEmails(new Date())).toEqual({ sent: 0 });
    sink.use();
    expect(await runChangeEmails(new Date())).toEqual({ sent: 1 });
    expect(mailsTo(v.email)[0]!.text).toContain('Dark mode moved to In progress');
  });

  it('sends nothing when nothing changed', async () => {
    const { v } = await setup();
    sink.use();
    expect(await runChangeEmails(new Date())).toEqual({ sent: 0 });
    expect(mailsTo(v.email)).toHaveLength(0);
  });

  it('sends no change email with change emails off, and nothing with updates off', async () => {
    const { member, states, issue, v } = await setup();
    await ok(await portal('me/updates', { cookie: v.cookie, body: { changeEmails: false } }));
    const other = await visitor('acme', 'Kim');
    await ok(
      await portal(`boards/acme/issues/${issue.identifier}/vote`, {
        cookie: other.cookie,
        body: {},
      }),
    );
    await ok(await portal('me/updates', { cookie: other.cookie, body: { enabled: false } }));
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    expect(await runChangeEmails(new Date())).toEqual({ sent: 0 });
    const monday = nextMonday(new Date());
    expect(await runSummaries(monday)).toEqual({ sent: 1 });
    expect(mailsTo(v.email)).toHaveLength(1);
    expect(mailsTo(v.email)[0]!.headers.subject).toBe('Your weekly summary');
    expect(mailsTo(other.email)).toHaveLength(0);
  });
});

describe('summaries', () => {
  it('sends the weekly summary once on Monday after 08:00, not again that week', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    const monday = nextMonday(new Date());
    const early = new Date(monday);
    early.setUTCHours(7, 0, 0, 0);
    expect(await runSummaries(early)).toEqual({ sent: 0 });
    expect(await runSummaries(monday)).toEqual({ sent: 1 });
    const tuesday = new Date(monday.getTime() + 24 * 60 * MINUTE);
    await updateIssue(member, issue.id, { stateId: states.completed });
    expect(await runSummaries(tuesday)).toEqual({ sent: 0 });
    const mails = mailsTo(v.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.headers.subject).toBe('Your weekly summary');
    expect(mails[0]!.text).toContain('Dark mode moved to In progress');
  });

  it('includes changes a change email already sent in a daily summary', async () => {
    const { member, states, issue, v } = await setup();
    await ok(await portal('me/updates', { cookie: v.cookie, body: { summary: 'daily' } }));
    sink.use();
    await updateIssue(member, issue.id, { stateId: states.started });
    await runChangeEmails(new Date());
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(9, 0, 0, 0);
    expect(await runSummaries(tomorrow)).toEqual({ sent: 1 });
    const mails = mailsTo(v.email);
    expect(mails.map((m) => m.headers.subject)).toEqual([
      'Updates on what you asked for',
      'Your daily summary',
    ]);
    expect(mails[1]!.text).toContain('Dark mode moved to In progress');
  });

  it('sends no summary when nothing is new, or when the summary is off', async () => {
    const { member, states, issue, v } = await setup();
    sink.use();
    const monday = nextMonday(new Date());
    expect(await runSummaries(monday)).toEqual({ sent: 0 });
    await ok(await portal('me/updates', { cookie: v.cookie, body: { summary: 'off' } }));
    await updateIssue(member, issue.id, { stateId: states.started });
    expect(await runSummaries(nextMonday(monday))).toEqual({ sent: 0 });
    expect(mailsTo(v.email)).toHaveLength(0);
  });
});

describe('internal routes', () => {
  const TOKEN = 'test-worker-token';
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.WORKER_INTERNAL_TOKEN;
    else process.env.WORKER_INTERNAL_TOKEN = previous;
  });

  it('need the worker token', async () => {
    for (const path of ['changes', 'summaries']) {
      const refused = await app.handle(
        new Request(`http://localhost/internal/requester-updates/${path}`, { method: 'POST' }),
      );
      expect(refused.status).toBe(401);
      const accepted = await app.handle(
        new Request(`http://localhost/internal/requester-updates/${path}`, {
          method: 'POST',
          headers: { 'x-worker-token': TOKEN },
        }),
      );
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ sent: 0 });
    }
  });
});
