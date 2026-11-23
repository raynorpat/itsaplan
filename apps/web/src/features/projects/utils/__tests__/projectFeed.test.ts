import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildProjectFeed } from '../projectFeed';

// The project's activity: its history (Project.history), its comment threads and its
// updates, newest first. Linked issues' activity is not part of it.

const history = [
  {
    id: 'h1',
    createdAt: '2026-01-01T10:00:00Z',
    entries: { action: 'created', actorId: 'u1', actorName: 'Ann' },
  },
  {
    id: 'h2',
    createdAt: '2026-01-03T10:00:00Z',
    entries: { action: 'status', from: 'backlog', to: 'started', actorId: 'u1', actorName: 'Ann' },
  },
  // An entry without an action describes nothing and is left out.
  { id: 'h3', createdAt: '2026-01-04T10:00:00Z', entries: {} },
];

const comment = (id: string, createdAt: string, parentId: string | null = null) => ({
  id,
  body: id,
  createdAt,
  editedAt: null,
  resolvedAt: null,
  parentId,
  user: { id: 'u2', name: 'Bob' },
});

const comments = [
  comment('c1', '2026-01-02T10:00:00Z'),
  comment('r1', '2026-01-05T10:00:00Z', 'c1'),
];

const updates = [
  {
    id: 'p1',
    createdAt: '2026-01-06T10:00:00Z',
    health: 'atRisk' as const,
    body: 'Slipping',
    user: { id: 'u1', name: 'Ann' },
  },
];

describe('buildProjectFeed', () => {
  const feed = buildProjectFeed(history, comments, updates);

  it('orders history, threads and updates newest first', () => {
    assert.deepEqual(
      feed.map((e) => e.id),
      ['p1', 'h2', 'c1', 'h1'],
    );
  });

  it('tells each entry kind apart', () => {
    assert.deepEqual(
      feed.map((e) => e.kind),
      ['update', 'history', 'comment', 'history'],
    );
  });

  it('keeps a reply under its root, which sorts by its own time', () => {
    const thread = feed.find((e) => e.kind === 'comment');
    assert.ok(thread?.kind === 'comment');
    assert.deepEqual(
      thread.thread.replies.map((r) => r.id),
      ['r1'],
    );
  });

  it("carries the history entry's change and actor", () => {
    const h = feed.find((e) => e.id === 'h2');
    assert.ok(h?.kind === 'history');
    assert.deepEqual(
      { action: h.action, from: h.from, to: h.to, actorName: h.actorName },
      { action: 'status', from: 'backlog', to: 'started', actorName: 'Ann' },
    );
  });

  it('names a removed actor and leaves a system change without one', () => {
    const [removed, system] = buildProjectFeed(
      [
        {
          id: 'a',
          createdAt: '2026-01-02T00:00:00Z',
          entries: { action: 'name', actorId: 'gone' },
        },
        { id: 'b', createdAt: '2026-01-01T00:00:00Z', entries: { action: 'name' } },
      ],
      [],
      [],
    );
    assert.ok(removed?.kind === 'history' && system?.kind === 'history');
    assert.equal(removed.actorName, 'a removed user');
    assert.equal(system.actorName, null);
  });
});
