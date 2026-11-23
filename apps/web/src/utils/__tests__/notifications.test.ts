import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notification } from '@/types/notification';
import { unreadCount } from '../notifications';

// The inbox badge: unread notifications that are neither archived nor snoozed.

const NOW = new Date('2026-11-23T12:00:00Z');

const n = (patch: Partial<Notification>): Notification =>
  ({
    id: Math.random().toString(36),
    readAt: null,
    snoozedUntil: null,
    archivedAt: null,
    ...patch,
  }) as Notification;

describe('unreadCount', () => {
  it('counts unread, unsnoozed, unarchived notifications', () => {
    const list = [
      n({}),
      n({ readAt: '2026-11-22T00:00:00Z' }),
      n({ archivedAt: '2026-11-22T00:00:00Z' }),
      n({ snoozedUntil: '2026-11-24T00:00:00Z' }),
      n({ snoozedUntil: '2026-11-22T00:00:00Z' }),
    ];
    assert.equal(unreadCount(list, NOW), 2);
  });
});
