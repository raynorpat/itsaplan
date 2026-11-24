import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_COMBOS } from '@/utils/hotkeys';
import { peekKeyAction } from '@/utils/list';

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

describe('peekKeyAction', () => {
  it('maps J, K, Space and Escape in the peek panel', () => {
    assert.equal(peekKeyAction(key('j'), DEFAULT_COMBOS), 'next');
    assert.equal(peekKeyAction(key('k'), DEFAULT_COMBOS), 'prev');
    assert.equal(peekKeyAction(key(' '), DEFAULT_COMBOS), 'close');
    assert.equal(peekKeyAction(key('Escape'), DEFAULT_COMBOS), 'close');
  });

  it('leaves the keys to the field while typing', () => {
    for (const t of [target('INPUT'), target('TEXTAREA'), target('DIV', true)]) {
      assert.equal(peekKeyAction(key('j', t), DEFAULT_COMBOS), null);
      assert.equal(peekKeyAction(key(' ', t), DEFAULT_COMBOS), null);
    }
  });

  it('ignores a key another layer already handled', () => {
    assert.equal(
      peekKeyAction(key('Escape', target('BODY'), { defaultPrevented: true }), DEFAULT_COMBOS),
      null,
    );
  });

  it('leaves Space to a focused button', () => {
    assert.equal(peekKeyAction(key(' ', target('BUTTON')), DEFAULT_COMBOS), null);
  });
});
