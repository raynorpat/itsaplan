import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actorDisplay } from '@/utils/actorDisplay';
import { commentToFeedItem } from '@/utils/commentThreads';

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
