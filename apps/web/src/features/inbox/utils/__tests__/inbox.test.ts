import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notification } from '@/lib/api';
import { readForCompletedIssues, visibleNotifications } from '../inbox';

// The workspace inbox works on every unarchived notification loaded in the browser:
// these pick what the list shows and what "Archive read for completed issues" takes.

const NOW = new Date('2026-11-23T12:00:00Z');

const n = (id: string, patch: Partial<Notification> = {}): Notification => ({
  id,
  type: 'assigned',
  actorUserId: null,
  actorName: null,
  readAt: null,
  snoozedUntil: null,
  archivedAt: null,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
  issueId: `issue-${id}`,
  issueSeq: 1,
  issueTitle: 'T',
  issueStateType: 'unstarted',
  teamId: 'team',
  teamKey: 'MKT',
  teamName: 'Marketing',
  ...patch,
});

const all = { showRead: true, showSnoozed: false, types: [] };
const ids = (list: Notification[]) => list.map((x) => x.id);

describe('visibleNotifications', () => {
  it('hides a notification snoozed until later', () => {
    const list = [n('a'), n('b', { snoozedUntil: '2026-11-24T09:00:00Z' })];
    assert.deepEqual(ids(visibleNotifications(list, all, NOW)), ['a']);
  });

  it('shows a notification whose snooze has passed', () => {
    const list = [n('a', { snoozedUntil: '2026-11-23T09:00:00Z' })];
    assert.deepEqual(ids(visibleNotifications(list, all, NOW)), ['a']);
  });

  it('shows snoozed notifications when asked', () => {
    const list = [n('a', { snoozedUntil: '2026-11-24T09:00:00Z' })];
    assert.deepEqual(ids(visibleNotifications(list, { ...all, showSnoozed: true }, NOW)), ['a']);
  });

  it('never shows an archived notification', () => {
    const list = [n('a', { archivedAt: '2026-11-22T09:00:00Z' }), n('b')];
    assert.deepEqual(ids(visibleNotifications(list, { ...all, showSnoozed: true }, NOW)), ['b']);
  });

  it('hides read notifications unless shown', () => {
    const list = [n('a', { readAt: '2026-11-21T09:00:00Z' }), n('b')];
    assert.deepEqual(ids(visibleNotifications(list, { ...all, showRead: false }, NOW)), ['b']);
  });

  it('filters by type', () => {
    const list = [n('a'), n('b', { type: 'commented' })];
    assert.deepEqual(ids(visibleNotifications(list, { ...all, types: ['commented'] }, NOW)), ['b']);
  });

  it('lists newest first', () => {
    const list = [
      n('old', { createdAt: '2026-11-01T00:00:00Z' }),
      n('new', { createdAt: '2026-11-22T00:00:00Z' }),
    ];
    assert.deepEqual(ids(visibleNotifications(list, all, NOW)), ['new', 'old']);
  });
});

describe('readForCompletedIssues', () => {
  it('takes read notifications on completed or canceled issues only', () => {
    const read = '2026-11-21T09:00:00Z';
    const list = [
      n('done-read', { readAt: read, issueStateType: 'completed' }),
      n('canceled-read', { readAt: read, issueStateType: 'canceled' }),
      n('done-unread', { issueStateType: 'completed' }),
      n('open-read', { readAt: read, issueStateType: 'started' }),
      n('done-archived', { readAt: read, issueStateType: 'completed', archivedAt: read }),
    ];
    assert.deepEqual(ids(readForCompletedIssues(list)), ['done-read', 'canceled-read']);
  });
});
