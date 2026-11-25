import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, externalUser, portalSummaryCache } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createComment,
  createIssue,
  createTeam,
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
import { aiSummary } from '../../ai';
import type { Change } from '../../changes';
import { runSummaries } from '../../run';
import { sinceLastVisit as sinceLastVisitOf } from '../../visits';

// The AI endpoint (an OpenAI-compatible chat completions server set up by an admin)
// writes the summaries' paragraph; any failure falls back to the round-up. The portal
// shows "Since your last visit" from the same changes.

type Mode = 'ok' | 'error' | 'hang' | 'notJson' | 'long';

interface Stub {
  mode: Mode;
  reply: string;
  requests: { auth: string | null; body: Json }[];
  url: string;
  stop(): void;
}

// A local stand-in for an OpenAI-compatible server.
function startStub(): Stub {
  const stub: Stub = {
    mode: 'ok',
    reply: 'Dark mode is now being worked on.',
    requests: [],
    url: '',
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== '/v1/chat/completions')
        return new Response('not found', { status: 404 });
      stub.requests.push({
        auth: req.headers.get('authorization'),
        body: (await req.json()) as Json,
      });
      switch (stub.mode) {
        case 'error':
          return new Response('{"error":"boom"}', { status: 500 });
        case 'hang':
          await Bun.sleep(2_000);
          return new Response('{}');
        case 'notJson':
          return new Response('<html>gateway</html>', {
            headers: { 'content-type': 'text/html' },
          });
        case 'long':
          return Response.json({ choices: [{ message: { content: 'x'.repeat(3_000) } }] });
        case 'ok':
          return Response.json({ choices: [{ message: { content: `  ${stub.reply}  ` } }] });
      }
    },
  });
  stub.url = `http://127.0.0.1:${server.port}/v1`;
  return stub;
}

let stub: Stub;
let sink: SmtpSink;
beforeAll(() => {
  stub = startStub();
  sink = startSmtpSink();
});
afterAll(() => {
  stub.stop();
  sink.stop();
});

beforeEach(async () => {
  await resetDb();
  stub.mode = 'ok';
  stub.requests = [];
  sink.mails = [];
  sink.fail = false;
  delete process.env.SMTP_HOST;
});

const configure = (owner: TestUser, apiKey = 'sk-test-secret') =>
  instance('ai/save', owner, { baseUrl: stub.url, model: 'test-model', apiKey });

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
  const v = await visitor('acme', 'Jo');
  await ok(
    await portal(`boards/acme/issues/${issue.identifier}/vote`, { cookie: v.cookie, body: {} }),
  );
  return { owner, member, states, issue, v };
}

const statusChange: Change = {
  kind: 'status',
  issueId: '00000000-0000-0000-0000-000000000001',
  identifier: 'ENG-1',
  title: 'Dark mode',
  from: 'planned',
  to: 'inProgress',
  duplicateOf: null,
  url: null,
  at: new Date(),
};

function nextMonday(d: Date): Date {
  const m = new Date(d);
  m.setUTCHours(9, 0, 0, 0);
  do m.setUTCDate(m.getUTCDate() + 1);
  while (m.getUTCDay() !== 1);
  return m;
}

describe('AI settings', () => {
  it('saves the endpoint and never returns the key', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    const res = await instance('ai', owner);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ baseUrl: stub.url, model: 'test-model', hasKey: true });
    expect(text).not.toContain('sk-test-secret');
  });

  it('keeps the stored key when the key is left empty', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    await ok(await instance('ai/save', owner, { baseUrl: stub.url, model: 'other', apiKey: '' }));
    expect(await ok(await instance('ai', owner))).toEqual({
      baseUrl: stub.url,
      model: 'other',
      hasKey: true,
    });
    expect(await ok(await instance('ai/test', owner, {}))).toEqual({ ok: true });
    expect(stub.requests.at(-1)!.auth).toBe('Bearer sk-test-secret');
    expect(stub.requests.at(-1)!.body.model).toBe('other');
  });

  it('refuses members and a non-http address', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const member = await signUpAs('member');
    expect((await instance('ai', member)).status).toBe(403);
    expect((await configure(member)).status).toBe(403);
    const bad = await instance('ai/save', owner, {
      baseUrl: 'ftp://example.com',
      model: 'm',
      apiKey: 'k',
    });
    expect(bad.status).toBe(400);
  });

  it('asks for the key again when the address moves to another host', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    const moved = await instance('ai/save', owner, {
      baseUrl: 'https://elsewhere.example/v1',
      model: 'test-model',
      apiKey: '',
    });
    expect(moved.status).toBe(400);
    await ok(
      await instance('ai/save', owner, {
        baseUrl: `${stub.url}/`,
        model: 'test-model',
        apiKey: '',
      }),
    );
    await ok(
      await instance('ai/save', owner, {
        baseUrl: 'https://elsewhere.example/v1',
        model: 'test-model',
        apiKey: 'sk-new',
      }),
    );
  });

  it('refuses an address with a user name, password or query string', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    for (const baseUrl of ['https://user:pass@example.com/v1', 'https://example.com/v1?x=1']) {
      const res = await instance('ai/save', owner, { baseUrl, model: 'm', apiKey: 'k' });
      expect(res.status).toBe(400);
    }
  });

  it('deletes the endpoint', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    await ok(await instance('ai/delete', owner, {}));
    expect(await ok(await instance('ai', owner))).toEqual({
      baseUrl: null,
      model: null,
      hasKey: false,
    });
  });

  it('tests the endpoint and reports a failure', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    expect(await ok(await instance('ai/test', owner, {}))).toEqual({ ok: true });
    stub.mode = 'error';
    const failed = await ok(await instance('ai/test', owner, {}));
    expect(failed.ok).toBe(false);
    expect(typeof failed.error).toBe('string');
  });
});

describe('aiSummary', () => {
  it('returns null when no endpoint is set up', async () => {
    expect(await aiSummary([statusChange], { displayName: 'Jo' })).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  it('returns the trimmed reply and sends the model, key and the changes', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    expect(await aiSummary([statusChange], { displayName: 'Jo' })).toBe(
      'Dark mode is now being worked on.',
    );
    const { auth, body } = stub.requests[0]!;
    expect(auth).toBe('Bearer sk-test-secret');
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(400);
    expect(body.temperature).toBe(0.3);
    expect(body.messages.map((m: Json) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[1].content).toContain('Dark mode');
  });

  for (const mode of ['error', 'notJson', 'long'] as const) {
    it(`returns null when the endpoint answers ${mode}`, async () => {
      const owner = await signUpTestUser({ name: 'Owner' });
      await ok(await configure(owner));
      stub.mode = mode;
      expect(await aiSummary([statusChange], { displayName: 'Jo' })).toBeNull();
    });
  }

  it('returns null when the endpoint does not answer in time', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await ok(await configure(owner));
    stub.mode = 'hang';
    const started = Date.now();
    expect(await aiSummary([statusChange], { displayName: 'Jo' }, { timeoutMs: 100 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});

describe('summary emails with an AI endpoint', () => {
  async function withReply() {
    const s = await setup();
    // The visitor's portal thread, a team reply in it and an internal comment.
    const root = (
      await ok(
        await portal(`boards/acme/issues/${s.issue.identifier}/comments`, {
          cookie: s.v.cookie,
          body: { body: 'Any news on this?' },
        }),
      )
    ).comment as Json;
    await createComment(s.member, {
      issueId: s.issue.id,
      body: 'Starting next week',
      parentId: root.id,
    });
    await createComment(s.member, { issueId: s.issue.id, body: 'SECRET-INTERNAL note' });
    await updateIssue(s.member, s.issue.id, { stateId: s.states.started });
    await ok(await configure(s.owner));
    sink.use();
    return s;
  }

  it('uses the written paragraph and sends only what the person may see', async () => {
    const { v } = await withReply();
    expect(await runSummaries(nextMonday(new Date()))).toEqual({ sent: 1 });
    const mail = sink.mails.find((m) => m.to.includes(v.email))!;
    expect(mail.text).toContain('Dark mode is now being worked on.');
    expect(mail.text).toContain('Dark mode moved to In progress');
    const sent = JSON.stringify(stub.requests[0]!.body);
    expect(sent).toContain('Starting next week');
    expect(sent).not.toContain('SECRET-INTERNAL');
    expect(sent).not.toContain(v.email);
  });

  it('falls back to the round-up when the endpoint fails', async () => {
    const { v } = await withReply();
    stub.mode = 'error';
    expect(await runSummaries(nextMonday(new Date()))).toEqual({ sent: 1 });
    const mail = sink.mails.find((m) => m.to.includes(v.email))!;
    expect(mail.text).not.toContain('Dark mode is now being worked on.');
    expect(mail.text).toContain('since your last summary');
    expect(mail.text).toContain('Dark mode moved to In progress');
  });
});

describe('a failing AI endpoint during a summary run', () => {
  it('is asked once, and the rest of the run uses the round-up', async () => {
    const { owner, member, states, issue, v } = await setup();
    const kim = await visitor('acme', 'Kim');
    await ok(
      await portal(`boards/acme/issues/${issue.identifier}/vote`, { cookie: kim.cookie, body: {} }),
    );
    await updateIssue(member, issue.id, { stateId: states.started });
    await ok(await configure(owner));
    stub.mode = 'error';
    sink.use();
    expect(await runSummaries(nextMonday(new Date()))).toEqual({ sent: 2 });
    expect(stub.requests).toHaveLength(1);
    expect(
      sink.mails.filter((m) => m.to.includes(v.email) || m.to.includes(kim.email)),
    ).toHaveLength(2);
  });
});

describe('since your last visit', () => {
  const sinceLastVisit = async (cookie: string) =>
    ok(await portal('me/since-last-visit', { cookie }));

  // Moves the person's recorded visits back, as if they last came two hours ago.
  const visitedHoursAgo = (requesterId: string, hours: number) =>
    db
      .update(externalUser)
      .set({ lastVisitAt: new Date(Date.now() - hours * 3_600_000) })
      .where(eq(externalUser.id, requesterId));

  it('is empty on the first visit', async () => {
    const { v } = await setup();
    expect(await sinceLastVisit(v.cookie)).toEqual({ paragraph: null, lines: [] });
  });

  it('lists what changed since the previous visit, with the paragraph written once a day', async () => {
    const { owner, member, states, issue, v } = await setup();
    await ok(await configure(owner));
    await sinceLastVisit(v.cookie);
    await updateIssue(member, issue.id, { stateId: states.started });
    // Within the hour this is the same visit: nothing since the previous one.
    expect(await sinceLastVisit(v.cookie)).toEqual({ paragraph: null, lines: [] });
    await visitedHoursAgo(v.requesterId, 2);
    const first = await sinceLastVisit(v.cookie);
    expect(first.lines).toEqual(['Dark mode moved to In progress']);
    expect(first.paragraph).toBe('Dark mode is now being worked on.');
    const again = await sinceLastVisit(v.cookie);
    expect(again).toEqual(first);
    expect(stub.requests).toHaveLength(1);
  });

  it("shows only the round-up when the day's paragraph no longer matches the changes", async () => {
    const { owner, member, states, issue, v } = await setup();
    await ok(await configure(owner));
    await sinceLastVisit(v.cookie);
    await updateIssue(member, issue.id, { stateId: states.started });
    await visitedHoursAgo(v.requesterId, 2);
    expect((await sinceLastVisit(v.cookie)).paragraph).toBe('Dark mode is now being worked on.');
    await updateIssue(member, issue.id, { stateId: states.completed });
    const later = await sinceLastVisit(v.cookie);
    expect(later.paragraph).toBeNull();
    expect(later.lines).toEqual(['Dark mode moved to Done']);
    expect(stub.requests).toHaveLength(1);
  });

  it('asks the model once when two tabs load at the same time', async () => {
    const { owner, member, states, issue, v } = await setup();
    await ok(await configure(owner));
    await sinceLastVisit(v.cookie);
    await updateIssue(member, issue.id, { stateId: states.started });
    await visitedHoursAgo(v.requesterId, 2);
    await sinceLastVisit(v.cookie);
    await db
      .update(externalUser)
      .set({ previousVisitAt: new Date(Date.now() - 3 * 3_600_000) })
      .where(eq(externalUser.id, v.requesterId));
    stub.requests = [];
    await db.delete(portalSummaryCache);
    await Promise.all([sinceLastVisit(v.cookie), sinceLastVisit(v.cookie)]);
    expect(stub.requests).toHaveLength(1);
  });

  it('answers without waiting long for a slow model and fills the paragraph in later', async () => {
    const { owner, member, states, issue, v } = await setup();
    await ok(await configure(owner));
    await sinceLastVisit(v.cookie);
    await updateIssue(member, issue.id, { stateId: states.started });
    await visitedHoursAgo(v.requesterId, 2);
    await sinceLastVisit(v.cookie);
    stub.mode = 'hang';
    await db.delete(portalSummaryCache);
    const started = Date.now();
    const quick = await sinceLastVisitOf(v.requesterId, new Date(), { waitMs: 100 });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(quick.paragraph).toBeNull();
    expect(quick.lines).toEqual(['Dark mode moved to In progress']);
  });

  it('needs a signed-in visitor', async () => {
    expect((await portal('me/since-last-visit')).status).toBe(401);
  });
});
