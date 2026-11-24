import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canMergePeople,
  feedbackCountText,
  lastFeedbackText,
  mergeConfirmText,
  isoString,
} from '../people';

const NOW = new Date('2026-11-24T15:00:00.000Z');

describe('lastFeedbackText', () => {
  it('reads "No feedback yet" without a date', () => {
    assert.equal(lastFeedbackText(null, NOW), 'No feedback yet');
  });
  it('reads today, yesterday and days ago', () => {
    assert.equal(lastFeedbackText('2026-11-24T01:00:00.000Z', NOW), 'Today');
    assert.equal(lastFeedbackText('2026-11-23T20:00:00.000Z', NOW), 'Yesterday');
    assert.equal(lastFeedbackText('2026-11-20T10:00:00.000Z', NOW), '4 days ago');
  });
  it('reads a date after a week', () => {
    assert.match(lastFeedbackText('2026-10-01T10:00:00.000Z', NOW), /Oct/);
  });
});

describe('feedbackCountText', () => {
  it('counts feedback items', () => {
    assert.equal(feedbackCountText(0), 'No feedback');
    assert.equal(feedbackCountText(1), '1 feedback item');
    assert.equal(feedbackCountText(3), '3 feedback items');
  });
});

describe('mergeConfirmText', () => {
  it('names both people and says it cannot be undone', () => {
    const text = mergeConfirmText({ name: 'Jane D' }, { name: 'Jane Doe' });
    assert.match(text, /Jane D/);
    assert.match(text, /Jane Doe/);
    assert.match(text, /cannot be undone/);
  });
});

describe('canMergePeople', () => {
  it('is for owners and admins only', () => {
    assert.equal(canMergePeople('owner'), true);
    assert.equal(canMergePeople('admin'), true);
    assert.equal(canMergePeople('member'), false);
    assert.equal(canMergePeople('guest'), false);
    assert.equal(canMergePeople(null), false);
  });
});

describe('isoString', () => {
  it('reads a Date or a string, else null', () => {
    assert.equal(isoString(new Date('2026-11-24T00:00:00.000Z')), '2026-11-24T00:00:00.000Z');
    assert.equal(isoString('2026-11-24T00:00:00.000Z'), '2026-11-24T00:00:00.000Z');
    assert.equal(isoString(null), null);
  });
});
