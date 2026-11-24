import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_COMBOS } from '@/utils/hotkeys';
import type { Notification } from '@/types/notification';
import { inboxKeyAction, snoozedIds } from '../inbox';

const target = (tagName: string, editable = false) =>
  ({ tagName, isContentEditable: editable, closest: () => null }) as unknown as EventTarget;

const key = (k: string, t: EventTarget = target('BODY'), extra: object = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: t,
  ...extra,
});

describe('inboxKeyAction', () => {
  it('archives the open notification with E', () => {
    assert.equal(inboxKeyAction(key('e'), DEFAULT_COMBOS), 'archive');
  });

  it('types the letter in a field instead', () => {
    for (const t of [target('INPUT'), target('TEXTAREA'), target('DIV', true)])
      assert.equal(inboxKeyAction(key('e', t), DEFAULT_COMBOS), null);
  });

  it('ignores other keys, modified E and handled events', () => {
    assert.equal(inboxKeyAction(key('j'), DEFAULT_COMBOS), null);
    assert.equal(inboxKeyAction(key('e', target('BODY'), { metaKey: true }), DEFAULT_COMBOS), null);
    assert.equal(
      inboxKeyAction(key('e', target('BODY'), { defaultPrevented: true }), DEFAULT_COMBOS),
      null,
    );
  });
});

describe('snoozedIds', () => {
  const NOW = new Date('2026-11-23T12:00:00Z');
  const n = (id: string, patch: Partial<Notification>) => ({ id, ...patch }) as Notification;

  it('takes unarchived notifications snoozed past now', () => {
    const list = [
      n('a', { snoozedUntil: '2026-11-24T00:00:00Z', archivedAt: null }),
      n('b', { snoozedUntil: null, archivedAt: null }),
      n('c', { snoozedUntil: '2026-11-22T00:00:00Z', archivedAt: null }),
      n('d', { snoozedUntil: '2026-11-25T00:00:00Z', archivedAt: '2026-11-21T00:00:00Z' }),
    ];
    assert.deepEqual(snoozedIds(list, NOW), ['a']);
  });
});
