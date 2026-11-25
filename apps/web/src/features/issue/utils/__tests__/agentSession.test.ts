import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FeedItem } from '@/types/issue';
import {
  canStopSession,
  issueSessionStatus,
  pollDelay,
  sessionStatus,
  sessionTimeline,
  threadSessionIds,
  type SessionActivity,
} from '../agentSession';

const act = (
  id: string,
  minute: number,
  type: SessionActivity['type'],
  extra: Partial<SessionActivity> = {},
): SessionActivity => ({
  id,
  createdAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`,
  type,
  body: `${type} ${id}`,
  action: null,
  parameter: null,
  result: null,
  ephemeral: false,
  signal: null,
  sourceCommentId: null,
  userName: 'Bot',
  ...extra,
});

const reply = (id: string, minute: number): FeedItem => ({
  id,
  issueId: 'i1',
  kind: 'comment',
  actorUserId: 'p1',
  actorName: 'Ann',
  body: 'please also fix X',
  action: null,
  subject: null,
  fromText: null,
  toText: null,
  parentId: 'root',
  editedAt: null,
  createdAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00Z`,
});

describe('sessionTimeline', () => {
  it('groups consecutive thoughts and actions into one collapsed step group', () => {
    const rows = sessionTimeline(
      [
        act('t1', 1, 'thought'),
        act('a1', 2, 'action', { action: 'Searching', parameter: 'auth.ts' }),
        act('e1', 3, 'elicitation'),
        act('t2', 4, 'thought'),
        act('r1', 5, 'response'),
      ],
      [],
    );
    assert.deepEqual(
      rows.map((r) => (r.kind === 'steps' ? `steps:${r.activities.length}` : `${r.kind}:${r.id}`)),
      ['steps:2', 'message:e1', 'steps:1', 'message:r1'],
    );
  });

  it('shows an ephemeral activity only while it is the latest', () => {
    const latest = sessionTimeline([act('t1', 1, 'thought', { ephemeral: true })], []);
    assert.equal(latest.length, 1);
    const superseded = sessionTimeline(
      [act('t1', 1, 'thought', { ephemeral: true }), act('a1', 2, 'action')],
      [],
    );
    assert.deepEqual(
      superseded.flatMap((r) => (r.kind === 'steps' ? r.activities.map((a) => a.id) : [])),
      ['a1'],
    );
  });

  it('shows a reply once: the comment, not the prompt it became', () => {
    const rows = sessionTimeline(
      [act('t1', 1, 'thought'), act('p1', 3, 'prompt', { sourceCommentId: 'c2', userName: 'Ann' })],
      [reply('c2', 3)],
    );
    assert.deepEqual(
      rows.map((r) => `${r.kind}:${r.kind === 'steps' ? r.activities[0].id : r.id}`),
      ['steps:t1', 'reply:c2'],
    );
  });

  it('keeps a prompt that has no comment (a stop or a repeated delegation)', () => {
    const rows = sessionTimeline(
      [act('t1', 1, 'thought'), act('p1', 2, 'prompt', { signal: 'stop', body: 'Stop' })],
      [],
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['steps', 'prompt'],
    );
  });

  it('orders replies and activities by time', () => {
    const rows = sessionTimeline(
      [act('r1', 5, 'response'), act('t1', 1, 'thought')],
      [reply('c1', 3)],
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['steps', 'reply', 'message'],
    );
  });
});

describe('session status', () => {
  it('names every status and marks errors', () => {
    assert.equal(sessionStatus('pending').label, 'Pending');
    assert.equal(sessionStatus('active').label, 'Working');
    assert.equal(sessionStatus('awaitingInput').label, 'Needs input');
    assert.equal(sessionStatus('complete').label, 'Done');
    assert.equal(sessionStatus('error').tone, 'error');
    assert.equal(sessionStatus('stopping').label, 'Stopping');
    assert.equal(sessionStatus('stale').label, 'Ended');
  });

  it('offers Stop only while the agent can still be stopped', () => {
    assert.equal(canStopSession('pending'), true);
    assert.equal(canStopSession('active'), true);
    assert.equal(canStopSession('awaitingInput'), true);
    assert.equal(canStopSession('complete'), false);
    assert.equal(canStopSession('stopping'), false);
    assert.equal(canStopSession('stale'), false);
  });
});

describe('sessions of a thread', () => {
  const entry = (rootSession: string | null, replies: (string | null)[]) => ({
    item: { ...reply('root', 0), agentSessionId: rootSession },
    replies: replies.map((s, i) => ({ ...reply(`r${i}`, i + 1), agentSessionId: s })),
    resolved: false,
  });

  it("lists the root's session, then each other session a reply started, once", () => {
    assert.deepEqual(threadSessionIds(entry('s1', [null, 's2', 's1', 's2', 's3'])), [
      's1',
      's2',
      's3',
    ]);
  });

  it('finds the sessions of a thread whose root has none', () => {
    assert.deepEqual(threadSessionIds(entry(null, [null, 's2'])), ['s2']);
    assert.deepEqual(threadSessionIds(entry(null, [null])), []);
  });

  it("hides another session's reply prompts without merging the replies again", () => {
    const rows = sessionTimeline(
      [act('p1', 2, 'prompt', { sourceCommentId: 'r0' }), act('t1', 3, 'thought')],
      [reply('r0', 1)],
      false,
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['steps'],
    );
  });
});

describe('polling', () => {
  const minute = 60_000;
  it('polls a live session until it has not changed for ten minutes', () => {
    assert.equal(pollDelay('active', 0, 9 * minute), 4000);
    assert.equal(pollDelay('pending', 0, 0), 4000);
    assert.equal(pollDelay('stopping', 0, 0), 4000);
    assert.equal(pollDelay('awaitingInput', 0, 0), false);
    assert.equal(pollDelay('active', 0, 11 * minute), false);
    assert.equal(pollDelay('complete', 0, 0), false);
  });
});

describe('issue session status', () => {
  it('shows the first open session, else none', () => {
    assert.equal(issueSessionStatus(['complete', 'awaitingInput', 'active']), 'awaitingInput');
    assert.equal(issueSessionStatus(['complete', 'stale']), null);
    assert.equal(issueSessionStatus([]), null);
  });
});
