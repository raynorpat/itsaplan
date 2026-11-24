import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actorDisplay } from '@/utils/actorDisplay';
import { buildThreads, commentToFeedItem, REMOVED_USER } from '@/utils/commentThreads';

// Who made a change or wrote a comment: a person, an app user, or a workflow (Linear's
// ActorBot of type "workflow").
describe('actorDisplay', () => {
  it('is a person', () => {
    assert.deepEqual(actorDisplay({ actor: { name: 'Ann' } }), { kind: 'user', name: 'Ann' });
  });

  it('is an app user', () => {
    assert.deepEqual(actorDisplay({ actor: { name: 'Deploy bot', app: true } }), {
      kind: 'app',
      name: 'Deploy bot',
    });
  });

  it('is a workflow', () => {
    assert.deepEqual(actorDisplay({ botActor: { type: 'workflow', name: 'Auto-close' } }), {
      kind: 'workflow',
      name: 'Auto-close',
    });
  });

  it('names a workflow without a name "a workflow"', () => {
    assert.deepEqual(actorDisplay({ botActor: { type: 'workflow', name: null } }), {
      kind: 'workflow',
      name: 'a workflow',
    });
  });

  it('is unknown without an actor', () => {
    assert.equal(actorDisplay({ actor: null, botActor: null }).kind, 'unknown');
  });
});

describe('commentToFeedItem with a workflow author', () => {
  it('names the workflow', () => {
    const item = commentToFeedItem(
      {
        id: 'c1',
        body: 'Closed automatically',
        createdAt: '2026-01-01T00:00:00Z',
        editedAt: null,
        resolvedAt: null,
        parentId: null,
        user: null,
        botActor: { type: 'workflow', name: 'Auto-close' },
      },
      'i1',
    );
    assert.equal(item.actorName, 'Auto-close');
    assert.equal(item.actorWorkflow, true);
  });
});

describe('portal visitors as comment authors', () => {
  const base = {
    body: 'Please add dark mode',
    createdAt: '2026-01-01T00:00:00Z',
    editedAt: null,
    resolvedAt: null,
    user: null,
    botActor: null,
  };
  const portalThread = { type: 'portal', name: 'Feedback', url: 'https://x/portal/feedback/ENG-1' };

  it('names the visitor for members', () => {
    assert.deepEqual(actorDisplay({ externalUser: { name: 'Jane Doe' } }), {
      kind: 'visitor',
      name: 'Jane Doe',
    });
  });

  it('is "Portal visitor" when the visitor is hidden (guests)', () => {
    assert.deepEqual(actorDisplay({ portal: true }), { kind: 'visitor', name: 'Portal visitor' });
  });

  it('marks a visitor root and a hidden visitor reply in a portal thread', () => {
    const threads = buildThreads(
      [
        { ...base, id: 'r', parentId: null, externalUser: null, externalThread: portalThread },
        { ...base, id: 'a', parentId: 'r', createdAt: '2026-01-02T00:00:00Z' },
        {
          ...base,
          id: 'b',
          parentId: 'r',
          createdAt: '2026-01-03T00:00:00Z',
          user: { id: 'u1', name: 'Pat' },
        },
      ],
      'i1',
    );
    const [root] = threads;
    assert.equal(root!.item.actorName, 'Portal visitor');
    assert.equal(root!.item.actorPortal, true);
    assert.equal(root!.replies[0]!.actorName, 'Portal visitor');
    assert.equal(root!.replies[0]!.actorPortal, true);
    assert.equal(root!.replies[1]!.actorName, 'Pat');
    assert.equal(root!.replies[1]!.actorPortal, false);
  });

  it('keeps an author-less comment outside portal threads a removed user', () => {
    const [entry] = buildThreads([{ ...base, id: 'x', parentId: null }], 'i1');
    assert.equal(entry!.item.actorName, REMOVED_USER);
    assert.equal(entry!.item.actorPortal, false);
  });
});

describe('portal thread roots', () => {
  it('name their board', () => {
    const item = commentToFeedItem(
      {
        id: 'r',
        body: 'We shipped this',
        createdAt: '2026-01-01T00:00:00Z',
        editedAt: null,
        resolvedAt: null,
        parentId: null,
        user: { id: 'u1', name: 'Pat' },
        externalThread: { type: 'portal', name: 'Feedback', url: null },
      },
      'i1',
    );
    assert.equal(item.portalBoard, 'Feedback');
    assert.equal(item.actorPortal, false);
  });
});
