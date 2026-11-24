import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notification } from '@/types/notification';
import { notificationText } from '../inbox';

// The event line of an inbox row names who acted: a person, a workflow (Linear's
// ActorBot), or "Someone" when neither is known.

const base: Notification = {
  id: 'n1',
  type: 'state_changed',
  actorUserId: null,
  actorName: null,
  actorWorkflow: false,
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
  issueId: 'i1',
  issueSeq: 1,
  issueTitle: 'T',
  issueStateType: 'unstarted',
  teamId: 'team',
  teamKey: 'ENG',
  teamName: 'Engineering',
};

describe('notificationText', () => {
  it('names a person', () => {
    assert.equal(
      notificationText({ ...base, actorUserId: 'u1', actorName: 'Ann' }),
      'Ann changed the status',
    );
  });

  it('names a workflow and marks it as one', () => {
    assert.equal(
      notificationText({ ...base, actorName: 'Auto-close', actorWorkflow: true }),
      'Auto-close (workflow) changed the status',
    );
    assert.equal(
      notificationText({ ...base, type: 'assigned', actorName: 'Triage', actorWorkflow: true }),
      'Triage (workflow) assigned the issue to you',
    );
  });

  it('falls back to Someone', () => {
    assert.equal(notificationText(base), 'Someone changed the status');
  });
});
