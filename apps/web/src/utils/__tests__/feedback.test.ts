import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canSeeFeedback,
  countPeople,
  feedbackHeader,
  guestFeedbackText,
  groupFeedbackByIssue,
  isFeedbackAttachment,
  isUnsubscribedRefusal,
  type FeedbackItem,
} from '../feedback';

function item(
  id: string,
  issue: { id: string; identifier: string; title: string },
  requesterId: string | null,
  createdAt = '2026-11-20T10:00:00.000Z',
): FeedbackItem {
  return {
    id,
    body: `quote ${id}`,
    important: false,
    createdAt,
    issue,
    attachmentId: `att-${id}`,
    source: 'Logged by Pat',
    requester: requesterId
      ? { id: requesterId, name: requesterId, email: null, avatarUrl: null }
      : null,
  };
}

const a = { id: 'i1', identifier: 'ENG-1', title: 'One' };
const b = { id: 'i2', identifier: 'ENG-2', title: 'Two' };

describe('feedbackHeader', () => {
  it('says person for one and people otherwise', () => {
    assert.equal(feedbackHeader(1), 'Feedback · 1 person');
    assert.equal(feedbackHeader(4), 'Feedback · 4 people');
    assert.equal(feedbackHeader(0), 'Feedback');
  });
});

describe('guestFeedbackText', () => {
  it('says how many people asked, and nothing when nobody did', () => {
    assert.equal(guestFeedbackText(1), '1 person asked for this');
    assert.equal(guestFeedbackText(4), '4 people asked for this');
    assert.equal(guestFeedbackText(0), null);
  });
});

describe('countPeople', () => {
  it('counts distinct requesters and leaves out feedback without one', () => {
    assert.equal(
      countPeople([item('1', a, 'r1'), item('2', a, 'r1'), item('3', a, 'r2'), item('4', a, null)]),
      2,
    );
  });
});

describe('groupFeedbackByIssue', () => {
  it('groups by issue, newest feedback first in a group, groups by their newest item', () => {
    const groups = groupFeedbackByIssue([
      item('1', a, 'r1', '2026-11-01T00:00:00.000Z'),
      item('2', b, 'r2', '2026-11-10T00:00:00.000Z'),
      item('3', a, 'r3', '2026-11-05T00:00:00.000Z'),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.issue.identifier, g.items.map((i) => i.id), g.people]),
      [
        ['ENG-2', ['2'], 1],
        ['ENG-1', ['3', '1'], 2],
      ],
    );
  });

  it('is empty for no feedback', () => {
    assert.deepEqual(groupFeedbackByIssue([]), []);
  });
});

describe('isFeedbackAttachment', () => {
  it('is true only for the feedback source type', () => {
    assert.equal(isFeedbackAttachment('feedback'), true);
    assert.equal(isFeedbackAttachment('upload'), false);
    assert.equal(isFeedbackAttachment(null), false);
  });
});

describe('canSeeFeedback', () => {
  it('shows feedback to owners, admins and members, not to guests or an unknown role', () => {
    assert.equal(canSeeFeedback('owner'), true);
    assert.equal(canSeeFeedback('admin'), true);
    assert.equal(canSeeFeedback('member'), true);
    assert.equal(canSeeFeedback('guest'), false);
    assert.equal(canSeeFeedback(null), false);
  });
});

describe('isUnsubscribedRefusal', () => {
  it('is the API refusing to turn updates on for someone who unsubscribed', () => {
    const apiError = (status: number) => Object.assign(new Error('refused'), { status });
    assert.equal(isUnsubscribedRefusal(apiError(409)), true);
    assert.equal(isUnsubscribedRefusal(apiError(403)), false);
    assert.equal(isUnsubscribedRefusal(new Error('network')), false);
  });
});
