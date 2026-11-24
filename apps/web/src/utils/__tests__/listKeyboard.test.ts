import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_COMBOS } from '@/utils/hotkeys';
import { listKeyAction, moveFocus } from '@/utils/list';

const order = ['a', 'b', 'c'];

describe('moveFocus', () => {
  it('starts at the first row on next and the last row on previous', () => {
    assert.equal(moveFocus(order, null, 1), 'a');
    assert.equal(moveFocus(order, null, -1), 'c');
  });

  it('moves one row and stops at the ends', () => {
    assert.equal(moveFocus(order, 'a', 1), 'b');
    assert.equal(moveFocus(order, 'b', -1), 'a');
    assert.equal(moveFocus(order, 'c', 1), 'c');
    assert.equal(moveFocus(order, 'a', -1), 'a');
  });

  it('restarts when the focused row is gone (collapsed group, filtered out)', () => {
    assert.equal(moveFocus(order, 'gone', 1), 'a');
    assert.equal(moveFocus(order, 'gone', -1), 'c');
  });

  it('has nothing to focus in an empty list', () => {
    assert.equal(moveFocus([], null, 1), null);
  });
});

const target = (tagName: string, insideRole: string | null = null) =>
  ({
    tagName,
    isContentEditable: false,
    closest: (selector: string) =>
      insideRole && selector.includes(`[role="${insideRole}"]`) ? {} : null,
  }) as unknown as EventTarget;

const key = (k: string, t: EventTarget = target('BODY'), mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: t,
  ...mods,
});

describe('listKeyAction', () => {
  it('maps Space on the page to peek, not on a focused button', () => {
    assert.equal(listKeyAction(key(' '), DEFAULT_COMBOS), 'peek');
    assert.equal(listKeyAction(key(' ', target('BUTTON')), DEFAULT_COMBOS), null);
  });

  it('maps J, K, X and Enter on the page', () => {
    assert.equal(listKeyAction(key('j'), DEFAULT_COMBOS), 'next');
    assert.equal(listKeyAction(key('k'), DEFAULT_COMBOS), 'prev');
    assert.equal(listKeyAction(key('x'), DEFAULT_COMBOS), 'select');
    assert.equal(listKeyAction(key('Enter'), DEFAULT_COMBOS), 'open');
  });

  it('ignores the keys while typing or inside a dialog or menu', () => {
    assert.equal(listKeyAction(key('j', target('INPUT')), DEFAULT_COMBOS), null);
    assert.equal(listKeyAction(key('x', target('BUTTON', 'dialog')), DEFAULT_COMBOS), null);
    assert.equal(listKeyAction(key('Enter', target('DIV', 'menu')), DEFAULT_COMBOS), null);
  });

  it('ignores the keys with a modifier held', () => {
    assert.equal(listKeyAction(key('j', target('BODY'), { metaKey: true }), DEFAULT_COMBOS), null);
  });
});

describe('listKeyAction: where the keys act', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}) =>
    ({
      tagName,
      isContentEditable: false,
      closest: () => null,
      hasAttribute: (name: string) => name in attrs,
    }) as unknown as EventTarget;

  it('acts on the page body and on the list container', () => {
    assert.equal(listKeyAction(key('j', el('BODY')), DEFAULT_COMBOS), 'next');
    assert.equal(
      listKeyAction(key('Enter', el('DIV', { 'data-list-root': '' })), DEFAULT_COMBOS),
      'open',
    );
  });

  it('leaves the keys to a focused button, link or row', () => {
    assert.equal(listKeyAction(key('Enter', el('BUTTON')), DEFAULT_COMBOS), null);
    assert.equal(listKeyAction(key('j', el('A')), DEFAULT_COMBOS), null);
    assert.equal(listKeyAction(key('x', el('DIV', { tabindex: '0' })), DEFAULT_COMBOS), null);
  });

  it('maps Escape to clear, but not once another layer handled it', () => {
    assert.equal(listKeyAction(key('Escape', el('BODY')), DEFAULT_COMBOS), 'clear');
    assert.equal(
      listKeyAction(key('Escape', el('BODY'), { defaultPrevented: true }), DEFAULT_COMBOS),
      null,
    );
    assert.equal(listKeyAction(key('Escape', target('BUTTON', 'dialog')), DEFAULT_COMBOS), null);
  });
});
