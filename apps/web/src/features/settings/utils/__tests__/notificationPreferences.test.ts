import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCategoryPreferencesInput, toNotificationPreferences } from '../notificationPreferences';

// Linear's UserSettings carries a channel set per category; the page edits the email
// channel of the four categories this instance sends.

const channels = (email: boolean) => ({ email });

describe('toNotificationPreferences', () => {
  it('reads the email channel of the four categories', () => {
    const prefs = toNotificationPreferences({
      assignments: channels(true),
      mentions: channels(false),
      commentsAndReplies: channels(true),
      statusChanges: channels(false),
    });
    assert.deepEqual(prefs, {
      emailCategories: {
        assignments: true,
        mentions: false,
        commentsAndReplies: true,
        statusChanges: false,
      },
    });
  });
});

describe('toCategoryPreferencesInput', () => {
  it('sends only the email channel per category', () => {
    assert.deepEqual(
      toCategoryPreferencesInput({
        emailCategories: {
          assignments: false,
          mentions: true,
          commentsAndReplies: false,
          statusChanges: true,
        },
      }),
      {
        assignments: { email: false },
        mentions: { email: true },
        commentsAndReplies: { email: false },
        statusChanges: { email: true },
      },
    );
  });
});
