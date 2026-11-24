import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  adjacentIssue,
  clearListOrder,
  issuePathFromIdentifier,
  pageNavKey,
  readListOrder,
  rememberListOrder,
} from '@/utils/issueNavigation';
import { issuePath } from '@/utils/paths';
import { DEFAULT_COMBOS } from '@/utils/hotkeys';

const a = { id: 'a', identifier: 'ENG-1' };
const b = { id: 'b', identifier: 'ENG-2' };
const c = { id: 'c', identifier: 'ENG-3' };

describe('adjacentIssue', () => {
  const order = [a, b, c];

  it('gives the position and both neighbours', () => {
    assert.deepEqual(adjacentIssue(order, 'b'), { index: 1, total: 3, prev: a, next: c });
  });

  it('does not wrap at the ends', () => {
    assert.equal(adjacentIssue(order, 'a')?.prev, null);
    assert.equal(adjacentIssue(order, 'c')?.next, null);
  });

  it('is null for an issue that is not in the list', () => {
    assert.equal(adjacentIssue(order, 'x'), null);
  });
});

describe('remembered list order', () => {
  beforeEach(() => clearListOrder());

  it('keeps the last list shown', () => {
    rememberListOrder([a, b]);
    assert.deepEqual(readListOrder(), [a, b]);
    clearListOrder();
    assert.deepEqual(readListOrder(), []);
  });
});

describe('issuePathFromIdentifier', () => {
  it('builds the team-scoped issue path', () => {
    assert.equal(issuePathFromIdentifier('ENG-12'), issuePath('ENG', 12));
  });
});

describe('pageNavKey', () => {
  const target = (tagName: string, editable = false) =>
    ({ tagName, isContentEditable: editable, closest: () => null }) as unknown as EventTarget;
  const key = (k: string, t: EventTarget = target('BODY'), extra: object = {}) => ({
    key: k,
    code: `Key${k.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: t,
    ...extra,
  });

  it('maps J / K to next / previous', () => {
    assert.equal(pageNavKey(key('j'), DEFAULT_COMBOS), 'next');
    assert.equal(pageNavKey(key('k'), DEFAULT_COMBOS), 'prev');
  });

  it('ignores keys typed into the title, description or comment box', () => {
    assert.equal(pageNavKey(key('j', target('INPUT')), DEFAULT_COMBOS), null);
    assert.equal(pageNavKey(key('k', target('TEXTAREA')), DEFAULT_COMBOS), null);
    assert.equal(pageNavKey(key('j', target('DIV', true)), DEFAULT_COMBOS), null);
  });

  it('ignores a handled key and other keys', () => {
    assert.equal(
      pageNavKey(key('j', target('BODY'), { defaultPrevented: true }), DEFAULT_COMBOS),
      null,
    );
    assert.equal(pageNavKey(key('x'), DEFAULT_COMBOS), null);
  });
});
