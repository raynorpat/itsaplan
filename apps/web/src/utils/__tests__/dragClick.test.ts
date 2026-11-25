import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suppressNextClick } from '../dragClick';

const click = (target: EventTarget) => {
  const e = new Event('click', { cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('suppressNextClick', () => {
  it('prevents the click that follows a drag, and only that one', () => {
    const target = new EventTarget();
    suppressNextClick(target);
    assert.equal(click(target), true);
    assert.equal(click(target), false);
  });

  it('stops waiting once the time is up, so a later click still works', async () => {
    const target = new EventTarget();
    suppressNextClick(target, 10);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(click(target), false);
  });
});
