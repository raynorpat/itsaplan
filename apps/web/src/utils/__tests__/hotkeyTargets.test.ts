import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blocksShortcuts } from '@/utils/hotkeys';

// A stand-in for a DOM element: tag, contenteditable and the closest() lookup the
// check uses.
const el = (tagName: string, insideRole: string | null = null, editable = false) =>
  ({
    tagName,
    isContentEditable: editable,
    closest: (selector: string) =>
      insideRole && selector.includes(`[role="${insideRole}"]`) ? {} : null,
  }) as unknown as EventTarget;

describe('blocksShortcuts', () => {
  it('blocks while typing', () => {
    assert.equal(blocksShortcuts(el('INPUT')), true);
    assert.equal(blocksShortcuts(el('TEXTAREA')), true);
    assert.equal(blocksShortcuts(el('DIV', null, true)), true);
  });

  it('blocks inside a dialog, an alert dialog, a menu or a listbox', () => {
    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox'])
      assert.equal(blocksShortcuts(el('BUTTON', role)), true, role);
  });

  it('lets shortcuts through on the page itself', () => {
    assert.equal(blocksShortcuts(el('BUTTON')), false);
    assert.equal(blocksShortcuts(el('BODY')), false);
    assert.equal(blocksShortcuts(null), false);
  });
});
